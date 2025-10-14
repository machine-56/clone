import random
import string
from django.shortcuts import redirect, render
from django.http import JsonResponse
from .models import *

import json
from django.utils import timezone
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.decorators import login_required
from django.core.paginator import Paginator

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



#? --- admin routes ---

def admin_login(request):
    if request.method == "POST":
        username = request.POST.get("username")
        password = request.POST.get("password")
        user = authenticate(request, username=username, password=password)
        if user is not None:
            login(request, user)
            return redirect("admin_dashboard")
        else:
            return render(request, "admin_login.html", {"error": "Invalid credentials"})
    return render(request, "admin_login.html")



@login_required(login_url="/ad/login/")
def admin_logout(request):
    logout(request)
    return redirect("admin_login")



@login_required(login_url="/ad/login/")
def admin_dashboard(request):
    meetings = Meeting.objects.all().order_by("-started_on")
    paginator = Paginator(meetings, 25)
    page_number = request.GET.get("page")
    page_obj = paginator.get_page(page_number)
    return render(request, "admin_dashboard.html", {"page_obj": page_obj})


@login_required(login_url="/ad/login/")
def admin_meeting_detail(request, mid):
    meeting = Meeting.objects.get(id=mid)
    participants = Participant.objects.filter(meeting=meeting).order_by("joined_at")
    return render(request, "admin_meeting_detail.html", {"meeting": meeting, "participants": participants})





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