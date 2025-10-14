from django.urls import path
from meetings import views

urlpatterns = [
    path('', views.index, name='index'),
    path('meet_code/<str:code>/', views.meeting, name='meeting'),

    #? admin routes
    path('ad/login/', views.admin_login, name='admin_login'),
    path('ad/logout/', views.admin_logout, name='admin_logout'),
    path('ad/dashboard/', views.admin_dashboard, name='admin_dashboard'),
    path('ad/meeting/<int:mid>/', views.admin_meeting_detail, name='admin_meeting_detail'),



#! --- stand alones ---
    path("verify_meeting/", views.verify_meeting, name="verify_meeting"),
    path("join_meeting/", views.join_meeting, name="join_meeting"),
    path("start_instant_meeting/", views.start_instant_meeting, name="start_instant_meeting"),
    path("schedule_meeting/", views.schedule_meeting, name="schedule_meeting"),
    path('end/<str:code>/', views.end_meeting, name='end_meeting'),

]
