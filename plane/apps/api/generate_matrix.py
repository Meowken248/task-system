import os
import sys
import django
import json
import re
from django.urls import get_resolver
from collections import defaultdict

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
            path = prefix + str(pattern.pattern)
            
            methods = []
            callback = pattern.callback
            view_class = None
            
            if hasattr(callback, 'actions'):
                methods = [m.upper() for m in callback.actions.keys()]
            elif hasattr(callback, 'view_class'):
                view_class = callback.view_class
                # For DRF APIView, check which methods are actually implemented
                for m in ['get', 'post', 'put', 'patch', 'delete', 'head', 'trace']:
                    if hasattr(view_class, m):
                        methods.append(m.upper())
            else:
                if hasattr(callback, 'cls'):
                    for m in ['get', 'post', 'put', 'patch', 'delete', 'head', 'trace']:
                        if hasattr(callback.cls, m):
                            methods.append(m.upper())
            
            if not methods:
                methods = ["GET", "POST", "PUT", "PATCH", "DELETE"]
                
            view_name = "UnknownView"
            module_name = "unknown"
            if hasattr(callback, 'view_class'):
                view_name = callback.view_class.__name__
                module_name = callback.view_class.__module__
            elif hasattr(callback, '__name__'):
                view_name = callback.__name__
                module_name = callback.__module__

            auth_classes = []
            perm_classes = []
            
            if view_class:
                if hasattr(view_class, 'authentication_classes'):
                    auth_classes = [c.__name__ for c in view_class.authentication_classes]
                if hasattr(view_class, 'permission_classes'):
                    perm_classes = [c.__name__ for c in view_class.permission_classes]
                    
            # Clean up the path
            clean_path = path.replace('^', '').replace('$', '')
            if not clean_path.startswith('/'):
                clean_path = '/' + clean_path
                
            urls.append({
                "path": clean_path,
                "methods": sorted(set(methods)),
                "view": f"{module_name}.{view_name}",
                "auth": auth_classes,
                "permissions": perm_classes
            })
    return urls

urls = get_urls()
# dedup
route_map = {}
for u in urls:
    # Use path as unique key for now, although technically method + path is the real unique key
    # But DRF routers group methods by path
    path = u["path"]
    if path not in route_map:
        route_map[path] = u
    else:
        route_map[path]["methods"] = sorted(set(route_map[path]["methods"] + u["methods"]))

# Try to load existing migration-route-matrix.json to keep any manual notes or status
existing_data = {}
try:
    with open('/code/migration-route-matrix.json', 'r') as f:
        existing_json = json.load(f)
        for group in existing_json.values():
            for route in group:
                path = route.get("url", "")
                if not path.startswith('/'):
                    path = '/' + path
                existing_data[path] = route
except Exception:
    pass

def get_group(path):
    parts = [p for p in path.split('/') if p and not p.startswith('^') and not p.startswith('<')]
    if len(parts) >= 2 and parts[0] == 'api':
        return f"/{parts[1]}"
    elif len(parts) >= 1:
        return f"/{parts[0]}"
    return "/other"

grouped = defaultdict(list)
for p in sorted(route_map.keys()):
    r = route_map[p]
    group_name = get_group(p)
    
    existing = existing_data.get(p, {})
    status = existing.get("status", "⏳ legacy")
    if "go_handler" in existing:
        status = existing.get("status", "✅ ported")
        
    grouped[group_name].append({
        "url": p,
        "methods": r["methods"],
        "python_view": r["view"],
        "go_handler": existing.get("go_handler", "TBD"),
        "owner": existing.get("owner", "TBD"),
        "authentication": r["auth"] if r["auth"] else existing.get("authentication", []),
        "permissions": r["permissions"] if r["permissions"] else existing.get("permissions", []),
        "request_schema": existing.get("request_schema", "TBD"),
        "response_schema": existing.get("response_schema", "TBD"),
        "db_side_effects": existing.get("db_side_effects", "TBD"),
        "background_side_effects": existing.get("background_side_effects", "TBD"),
        "test_status": existing.get("test_status", "TBD"),
        "known_differences": existing.get("known_differences", "TBD"),
        "status": status,
        "notes": existing.get("notes", "")
    })

# Write JSON
with open("/code/migration-route-matrix.json", "w") as f:
    json.dump(grouped, f, indent=2)

# Write Markdown
with open("/code/route_parity_matrix.md", "w", encoding="utf-8") as f:
    f.write("# Route Parity Matrix\n")
    f.write("Generated matrix containing all required parity fields.\n\n")
    for group in sorted(grouped.keys()):
        f.write(f"## {group}\n")
        f.write("| Django Route | Methods | Python View | Go Handler | Auth/Perms | Status | Notes |\n")
        f.write("|---|---|---|---|---|---|---|\n")
        for r in grouped[group]:
            methods_str = ", ".join(r["methods"])
            auth_perms = f"Auth: {','.join(r['authentication'])}<br>Perms: {','.join(r['permissions'])}"
            f.write(f"| `{r['url']}` | {methods_str} | `{r['python_view']}` | `{r['go_handler']}` | {auth_perms} | {r['status']} | {r['notes']} |\n")
        f.write("\n")

print("Generated route_parity_matrix.md and migration-route-matrix.json successfully.")
