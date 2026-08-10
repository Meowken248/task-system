import re

def extract_go_routes(filepath):
    routes = []
    with open(filepath, 'r') as f:
        content = f.read()
    
    # Regex to match mux.Handle or mux.HandleFunc calls
    # Examples:
    # mux.Handle("GET /api/users/me/", deps.CurrentUser)
    # mux.Handle("/api/workspaces/{$}", deps.Workspaces)
    # mux.HandleFunc("GET /health/live", ...)
    
    pattern = re.compile(r'mux\.Handle(?:Func)?\(\s*"([^"]+)"')
    matches = pattern.findall(content)
    for m in matches:
        routes.append(m)
        
    return routes

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        filepath = sys.argv[1]
    else:
        filepath = "c:\\task-system\\plane\\apps\\go-api\\internal\\httpapi\\router.go"
    
    routes = extract_go_routes(filepath)
    for r in sorted(set(routes)):
        print(r)
