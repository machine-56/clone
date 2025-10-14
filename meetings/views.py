import random
import string
from django.shortcuts import redirect, render
from django.http import JsonResponse
from .models import *

import json
from django.utils import timezone

# Create your views here.
def index(request):
    return render(request, 'home.html')


def meeting(request, code):
    meeting_id = code
    print(f'[meeting]? === meeting id : {meeting_id}')
    print(f'[meeting] === meeting pwd : {Meeting.objects.get(meeting_code = meeting_id).meeting_pwd}')

    #? user_allowed = MeetingParticipant.objects.filter(
    #?     user=request.user,
    #?     meeting_code=code
    #? ).exists()

    user_allowed = True  # ? remove later
    
    if not user_allowed:
        return redirect("index")

    meeting_data = Meeting.objects.get(meeting_code = meeting_id)

    print(f'[meeting] === meeting data : {meeting_data}')
    return render(request, 'meeting.html', {'meeting_data': meeting_data})




#! --- stand alones ---

def verify_meeting(request):
    if request.method == "POST":
        payload = json.loads(request.body.decode("utf-8"))
        code = payload.get("meeting_code")
        password = payload.get("password")

        try:
            meeting = Meeting.objects.get(meeting_code=code, meeting_pwd=password)
            return JsonResponse({"success": True, "meeting_code": meeting.meeting_code})
        except Meeting.DoesNotExist:
            return JsonResponse({"success": False, "error": "invalid_credentials"})
    return JsonResponse({"success": False, "error": "invalid_method"}, status=405)


def join_meeting(request):
    if request.method == "POST":
        payload = json.loads(request.body.decode("utf-8"))
        code = payload.get("meeting_code")
        name = payload.get("name")
        designation = payload.get("designation")

        if not (code and name and designation):
            return JsonResponse({"success": False, "error": "missing_fields"})

        try:
            meeting = Meeting.objects.get(meeting_code=code)
            Participant.objects.create(
                meeting=meeting,
                name=name,
                designation=designation
            )
            return JsonResponse({"success": True})
        except Meeting.DoesNotExist:
            return JsonResponse({"success": False, "error": "meeting_not_found"})
    return JsonResponse({"success": False, "error": "invalid_method"}, status=405)


def start_instant_meeting(request):
    if request.method == "POST":
        payload = json.loads(request.body.decode("utf-8"))
        name = payload.get("name")
        designation = payload.get("designation")

        code = generate_code()
        pwd = generate_password()

        meeting = Meeting.objects.create(
            host_name=name,
            host_designation=designation,
            meeting_code=code,
            meeting_pwd=pwd,
            started_on=timezone.now()
        )

        return JsonResponse({"success": True, "meeting_code": meeting.meeting_code, "password": meeting.meeting_pwd})
    return JsonResponse({"success": False, "error": "invalid_request"}, status=400)


def schedule_meeting(request):
    if request.method == "POST":
        payload = json.loads(request.body.decode("utf-8"))
        name = payload.get("name")
        designation = payload.get("designation")
        time_str = payload.get("time")

        code = generate_code()
        pwd = generate_password()

        if time_str:
            # store with given scheduled time
            scheduled_time = timezone.make_aware(
                timezone.datetime.combine(timezone.now().date(), timezone.datetime.strptime(time_str, "%H:%M").time())
            )
        else:
            scheduled_time = timezone.now()

        meeting = Meeting.objects.create(
            host_name=name,
            host_designation=designation,
            meeting_code=code,
            meeting_pwd=pwd,
            started_on=scheduled_time
        )

        return JsonResponse({"success": True, "meeting_code": meeting.meeting_code, "password": meeting.meeting_pwd})
    return JsonResponse({"success": False, "error": "invalid_request"}, status=400)


def end_meeting(request, code):
    mt = Meeting.objects.filter(meeting_code=code).first()
    if not mt:
        return JsonResponse({"success": False})
    mt.host_status = 2
    mt.save(update_fields=["host_status"])
    return JsonResponse({"success": True})



def generate_code(length=8):
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=length))

def generate_password(length=6):
    return ''.join(random.choices(string.ascii_letters + string.digits, k=length))