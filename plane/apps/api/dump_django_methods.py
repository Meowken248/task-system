import os
import sys
import django
import json
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
            path = prefix + str(pattern.pattern)
            
            # Figure out the methods
            methods = []
            callback = pattern.callback
            
            if hasattr(callback, 'actions'):
                # ViewSet
                methods = [m.upper() for m in callback.actions.keys()]
            elif hasattr(callback, 'view_class'):
                # Class based view (APIView, etc)
                view_class = callback.view_class
                if hasattr(view_class, 'http_method_names'):
                    methods = [m.upper() for m in view_class.http_method_names if m.upper() != 'OPTIONS']
            else:
                # Function based view? Try checking if it has a list of methods (uncommon in DRF unless @api_view)
                if hasattr(callback, 'cls') and hasattr(callback.cls, 'http_method_names'):
                     methods = [m.upper() for m in callback.cls.http_method_names if m.upper() != 'OPTIONS']
                else:
                    methods = ["GET", "POST", "PUT", "PATCH", "DELETE"] # Fallback
            
            if not methods:
                methods = ["GET", "POST", "PUT", "PATCH", "DELETE"] # Fallback
                
            view_name = ""
            if hasattr(callback, 'view_class'):
                view_name = callback.view_class.__name__
            elif hasattr(callback, '__name__'):
                view_name = callback.__name__

            urls.append({
                "path": path,
                "methods": sorted(set(methods)),
                "view": view_name
            })
    return urls

urls = get_urls()
# deduplicate paths that might be registered multiple times (e.g. different regexes for format suffix)
route_map = {}
for u in urls:
    path = u["path"]
    if path not in route_map:
        route_map[path] = u
    else:
        route_map[path]["methods"] = sorted(set(route_map[path]["methods"] + u["methods"]))

output = []
for p in sorted(route_map.keys()):
    output.append(route_map[p])

with open("django_methods.json", "w") as f:
    json.dump(output, f, indent=2)

print("Done generating django_methods.json")
