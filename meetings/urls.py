from django.urls import path
from meetings import views

urlpatterns = [
    path('', views.index, name='index'),
    path('meet_code/<str:code>/', views.meeting, name='meeting'),



#! --- stand alones ---
    path("verify_meeting/", views.verify_meeting, name="verify_meeting"),
    path("join_meeting/", views.join_meeting, name="join_meeting"),
    path("start_instant_meeting/", views.start_instant_meeting, name="start_instant_meeting"),
    path("schedule_meeting/", views.schedule_meeting, name="schedule_meeting"),

]
