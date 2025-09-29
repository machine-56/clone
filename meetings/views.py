from django.shortcuts import render

from django.http import JsonResponse
import json

# Create your views here.
def index(request):
    return render(request, 'home.html')




#! --- stand alones ---

def verify_meeting(request):
    if request.method == "POST":
        try:
            payload = json.loads(request.body.decode("utf-8"))
        except Exception:
            return JsonResponse({"success": False, "error": "invalid_json"}, status=400)

        meeting_code = payload.get("meeting_code")
        password = payload.get("password")

        # Dummy check
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

        if meeting_code == "meeting" and name and designation:
            return JsonResponse({"success": True})
        return JsonResponse({"success": False, "error": "invalid_data"})
    
    return JsonResponse({"success": False, "error": "invalid_method"}, status=405)