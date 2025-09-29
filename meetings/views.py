from django.shortcuts import redirect, render
from django.http import JsonResponse
import json

# Create your views here.
def index(request):
    return render(request, 'home.html')


def meeting(request, code):
    meeting_id = code
    print(f'[meeting] === meeting id : {meeting_id}')

    #? user_allowed = MeetingParticipant.objects.filter(
    #?     user=request.user,
    #?     meeting_code=code
    #? ).exists()

    user_allowed = True  # ? remove later
    
    if not user_allowed:
        return redirect("index")

    meeting_data = {
        'name': 'demo name',
        'host': 'demo host',
        'meeting_code': meeting_id
    }
    return render(request, 'meeting.html', {'meeting_data': meeting_data})





#! --- stand alones ---

def verify_meeting(request):
    if request.method == "POST":
        try:
            payload = json.loads(request.body.decode("utf-8"))
        except Exception:
            return JsonResponse({"success": False, "error": "invalid_json"}, status=400)

        meeting_code = payload.get("meeting_code")
        password = payload.get("password")
        print(f'[verify_meeting] === meeting_code : {meeting_code}\npassword : {password}')

        #TODO: Dummy check
        if meeting_code == "meeting" and password == "1234":
            return JsonResponse({"success": True, "meeting_code": meeting_code})
        return JsonResponse({"success": False, "error": "invalid_credentials"})
    
    return JsonResponse({"success": False, "error": "invalid_method"}, status=405)


def join_meeting(request):
    if request.method == "POST":
        try:
            payload = json.loads(request.body.decode("utf-8"))
        except Exception:
            return JsonResponse({"success": False, "error": "invalid_json"}, status=400)

        meeting_code = payload.get("meeting_code")
        name = payload.get("name")
        designation = payload.get("designation")

        print("[JOIN MEETING PAYLOAD]", payload)

        if meeting_code == "meeting" and name and designation: #TODO: change to check and save later
            # obj = MeetingParticipant(
            #   meet_id = Meetings..objects.filter(code = meeting_code).first()
            #   name = name
            #   designation = designation
            # )
            # obj.save()
            return JsonResponse({"success": True})
        return JsonResponse({"success": False, "error": "invalid_data"})
    
    return JsonResponse({"success": False, "error": "invalid_method"}, status=405)