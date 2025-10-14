from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    re_path(r"ws/meet/(?P<code>[\w\-]+)/$", consumers.MeetingConsumer.as_asgi()),
]
