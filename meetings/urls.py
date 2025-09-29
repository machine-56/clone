from django.urls import path
from meetings import views

urlpatterns = [
    path('', views.index, name='index'),



#! --- stand alones ---
    path("verify_meeting/", views.verify_meeting, name="verify_meeting"),
    path("join_meeting/", views.join_meeting, name="join_meeting"),

]
