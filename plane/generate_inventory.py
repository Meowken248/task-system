import re
import codecs

def read_utf16_file(filepath):
    try:
        with codecs.open(filepath, 'r', encoding='utf-16le') as f:
            return [line.strip() for line in f if line.strip()]
    except Exception:
        with codecs.open(filepath, 'r', encoding='utf-8') as f:
            return [line.strip() for line in f if line.strip()]

def format_django_route(route):
    # Convert <type:name> to {name}
    route = re.sub(r'<[^>]+:([^>]+)>', r'{\1}', route)
    # Ensure starting with /
    if not route.startswith('/'):
        route = '/' + route
    return route

def main():
    django_routes = read_utf16_file('c:/task-system/plane/django_routes.txt')
    go_routes_raw = read_utf16_file('c:/task-system/plane/go_routes.txt')

    django_formatted = sorted(set([format_django_route(r) for r in django_routes]))
    
    # Go routes have some wildcards like {tail...} and are sometimes prefixed with METHOD
    go_formatted = []
    for r in go_routes_raw:
        parts = r.split(' ')
        if len(parts) > 1:
            route = parts[1]
        else:
            route = parts[0]
        go_formatted.append(route)
    
    go_formatted = sorted(set(go_formatted))

    with open('c:/task-system/plane/route_inventory.md', 'w', encoding='utf-8') as f:
        f.write("# API Route Inventory\n\n")
        
        f.write("## 1. Django Routes (Legacy API)\n")
        f.write("These are the routes currently registered in Django.\n\n")
        f.write("```\n")
        for r in django_formatted:
            f.write(r + "\n")
        f.write("```\n\n")

        f.write("## 2. Go Routes (New API)\n")
        f.write("These are the root handlers registered in Go.\n")
        f.write("Note: Go uses wildcard routes like `/api/workspaces/{slug}/projects/{tail...}` which handle many sub-paths internally.\n\n")
        f.write("```\n")
        for r in go_formatted:
            f.write(r + "\n")
        f.write("```\n\n")

if __name__ == '__main__':
    main()
