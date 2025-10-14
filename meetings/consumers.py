# meetings/consumers.py
import json
from channels.generic.websocket import AsyncWebsocketConsumer
from django.utils import timezone
from .models import Meeting

class MeetingConsumer(AsyncWebsocketConsumer):
    """
    Minimal, robust signaling hub.
    - Tracks participants per meeting group (in-memory map on channel_layer).
    - Broadcasts join/leave + chat + WebRTC SDP/ICE.
    - Sends a full participant list to each newly joined client.
    """

    async def connect(self):
        self.code = self.scope["url_route"]["kwargs"]["code"]
        self.group_name = f"meet_{self.code}"
        await self.channel_layer.group_add(self.group_name, self.channel_name)

        # In-memory participants map: { group_name: { channel_name: {clientId, name} } }
        if not hasattr(self.channel_layer, "participants"):
            self.channel_layer.participants = {}
        self.channel_layer.participants.setdefault(self.group_name, {})

        await self.accept()

    async def disconnect(self, close_code):
        # Remove from participants and broadcast leave
        group_participants = self.channel_layer.participants.get(self.group_name, {})
        info = group_participants.pop(self.channel_name, None)

        await self.channel_layer.group_discard(self.group_name, self.channel_name)

        if info:
            await self.channel_layer.group_send(
                self.group_name,
                {
                    "type": "presence.leave",
                    "payload": {
                        "clientId": info.get("clientId"),
                        "name": info.get("name") or "Peer",
                    },
                },
            )

    async def receive(self, text_data=None, bytes_data=None):
        msg = json.loads(text_data or "{}")
        t = msg.get("type")

        # ---- presence / join -------------------------------------------------
        if t == "presence":
            client_id = msg.get("clientId")
            name = (msg.get("name") or "Peer").strip() or "Peer"

            # Track participant under this channel
            group_participants = self.channel_layer.participants.setdefault(self.group_name, {})
            group_participants[self.channel_name] = {"clientId": client_id, "name": name}

            # If host joins for the first time, mark meeting started
            if msg.get("is_host"):
                try:
                    mt = Meeting.objects.get(meeting_code=self.code)
                    if mt.host_status == 0:
                        mt.host_status = 1
                        mt.started_on = timezone.now()
                        mt.save(update_fields=["host_status", "started_on"])
                except Meeting.DoesNotExist:
                    pass

            # Send full participant list to the new client (by clientId + name)
            participants_payload = [
                v for _, v in group_participants.items()
            ]
            await self.send(
                text_data=json.dumps(
                    {
                        "type": "participant_list",
                        "participants": participants_payload,
                    }
                )
            )

            # Tell everyone else that this person arrived
            await self.channel_layer.group_send(
                self.group_name,
                {
                    "type": "presence.join",
                    "payload": {
                        "clientId": client_id,
                        "name": name,
                    },
                },
            )
            return

        # ---- leave (explicit) -----------------------------------------------
        if t == "leave":
            # Client may proactively notify before unload; remove and fan out
            group_participants = self.channel_layer.participants.get(self.group_name, {})
            info = group_participants.pop(self.channel_name, None)
            if info:
                await self.channel_layer.group_send(
                    self.group_name,
                    {
                        "type": "presence.leave",
                        "payload": {
                            "clientId": info.get("clientId"),
                            "name": info.get("name") or "Peer",
                        },
                    },
                )
            return

        # ---- chat ------------------------------------------------------------
        if t == "chat":
            await self.channel_layer.group_send(
                self.group_name, {"type": "chat.broadcast", "payload": msg}
            )
            return

        # ---- hand raise ------------------------------------------------------
        if t == "hand":
            await self.channel_layer.group_send(
                self.group_name, {"type": "hand.broadcast", "payload": msg}
            )
            return

        # ---- screenshare (start/stop) ---------------------------------------
        if t == "screenshare":
            # payload: { type:"screenshare", action:"start"|"stop", clientId, name }
            await self.channel_layer.group_send(
                self.group_name, {"type": "screenshare.broadcast", "payload": msg}
            )
            return

        # ---- WebRTC signaling ------------------------------------------------
        if t in ("offer", "answer", "candidate"):
            # Broadcast; clients filter by {to}
            await self.channel_layer.group_send(
                self.group_name, {"type": "signal.broadcast", "payload": msg}
            )
            return

        # ---- end meeting (host) ---------------------------------------------
        if t == "end_meeting":
            try:
                mt = Meeting.objects.get(meeting_code=self.code)
                mt.host_status = 2
                mt.save(update_fields=["host_status"])
            except Meeting.DoesNotExist:
                pass

            await self.channel_layer.group_send(
                self.group_name, {"type": "end.broadcast", "payload": {"msg": "Meeting ended"}}
            )
            return

    # ---- Fan-out handlers ----------------------------------------------------

    async def presence_join(self, event):
        await self.send(text_data=json.dumps({"type": "presence", **event["payload"]}))

    async def presence_leave(self, event):
        await self.send(text_data=json.dumps({"type": "leave", **event["payload"]}))

    async def chat_broadcast(self, event):
        await self.send(text_data=json.dumps({"type": "chat", **event["payload"]}))

    async def hand_broadcast(self, event):
        await self.send(text_data=json.dumps({"type": "hand", **event["payload"]}))

    async def screenshare_broadcast(self, event):
        await self.send(text_data=json.dumps({"type": "screenshare", **event["payload"]}))

    async def signal_broadcast(self, event):
        await self.send(text_data=json.dumps(event["payload"]))

    async def end_broadcast(self, event):
        await self.send(text_data=json.dumps({"type": "end_meeting"}))
