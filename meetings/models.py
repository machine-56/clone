from django.db import models

# Create your models here.
from django.db import models

class Meeting(models.Model):
    HOST_STATUS_CHOICES = [
        (0, 'Not Joined'),
        (1, 'Joined'),
        (2, 'Ended'),
    ]

    host_name = models.CharField(max_length=128)
    host_designation = models.CharField(max_length=128)
    meeting_code = models.CharField(max_length=12, unique=True)
    meeting_pwd = models.CharField(max_length=12)
    host_status = models.IntegerField(choices=HOST_STATUS_CHOICES, default=0)
    started_on = models.DateTimeField()

    def __str__(self):
        return f"{self.meeting_code} - {self.host_name}"


class Participant(models.Model):
    meeting = models.ForeignKey(Meeting, on_delete=models.CASCADE, related_name="participants")
    name = models.CharField(max_length=128)
    designation = models.CharField(max_length=128)
    joined_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.name} ({self.meeting.meeting_code})"
