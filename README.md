# Meeting Platform

## Dependencies
- Django  
- Channels  
- Channels-Redis  
- mysqlclient  
- Daphne  

Install all dependencies:
```bash
pip install django channels channels-redis mysqlclient daphne
```

Redis (must be running on port 6379)

If Redis runs on a different host or port, edit this in settings.py:
```
CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {
            "hosts": [("127.0.0.1", 6379)]  # change if different
        },
    },
}
```

Run Commands:
```bash
python manage.py makemigrations
python manage.py migrate
python manage.py createsuperuser   # for admin login (required)
python -m daphne -p 8000 connectly.asgi:application
```

Admin Access

Open in browser:
http://<your-domain-or-localhost>/ad/login/