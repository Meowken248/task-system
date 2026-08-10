import os
import sys
import django
from django.urls import get_resolver

# Add /code to PYTHONPATH
sys.path.insert(0, '/code')
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "plane.settings.local")
django.setup()

def get_urls(resolver=None, prefix=''):
    if resolver is None:
        resolver = get_resolver()
    urls = []
    for pattern in resolver.url_patterns:
        if hasattr(pattern, 'url_patterns'):
            # It's an URLResolver
            urls.extend(get_urls(pattern, prefix + str(pattern.pattern)))
        else:
            # It's an URLPattern
            urls.append(prefix + str(pattern.pattern))
    return urls

urls = get_urls()
for u in sorted(set(urls)):
    print(u)
