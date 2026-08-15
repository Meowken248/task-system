import requests
import json
import copy
import re
import argparse
import sys
from pprint import pprint

def normalize_data(data):
    """
    Recursively canonicalize dynamic fields like timestamps and UUIDs.
    """
    if isinstance(data, dict):
        new_data = {}
        for k, v in data.items():
            if k in ['created_at', 'updated_at', 'deleted_at', 'timestamp'] and v is not None:
                new_data[k] = "<TIMESTAMP>"
            elif k in ['id', 'uuid', 'token'] and v is not None:
                # In many cases IDs are exactly the same if pulling from DB, 
                # but if generating new ones, we'd replace them.
                # If they are DB fetched, they should match.
                new_data[k] = v
            else:
                new_data[k] = normalize_data(v)
        return new_data
    elif isinstance(data, list):
        return [normalize_data(item) for item in data]
    else:
        return data

def compare_responses(django_resp, go_resp):
    errors = []
    
    if django_resp.status_code != go_resp.status_code:
        errors.append(f"Status Code Mismatch: Django={django_resp.status_code}, Go={go_resp.status_code}")
        
    try:
        django_json = django_resp.json()
    except:
        django_json = django_resp.text
        
    try:
        go_json = go_resp.json()
    except:
        go_json = go_resp.text
        
    if isinstance(django_json, (dict, list)) and isinstance(go_json, (dict, list)):
        django_norm = normalize_data(django_json)
        go_norm = normalize_data(go_json)
        
        # We can use json dumps to compare or a deep dict compare
        dj_str = json.dumps(django_norm, sort_keys=True)
        go_str = json.dumps(go_norm, sort_keys=True)
        
        if dj_str != go_str:
            errors.append("JSON Content Mismatch")
            # In a real tool, we would use deepdiff here.
            
    else:
        if str(django_json) != str(go_json):
            errors.append("Text Content Mismatch")
            
    return errors, django_json, go_json

def run_contract_test(method, path, headers=None, json_data=None):
    django_url = f"http://localhost:8000{path}"
    go_url = f"http://localhost:8001{path}"
    
    print(f"Testing {method} {path}...")
    
    req_kwargs = {}
    if headers:
        req_kwargs["headers"] = headers
    if json_data:
        req_kwargs["json"] = json_data
        
    django_resp = requests.request(method, django_url, **req_kwargs)
    go_resp = requests.request(method, go_url, **req_kwargs)
    
    errors, dj_json, go_json = compare_responses(django_resp, go_resp)
    
    if errors:
        print(f"❌ FAILED: {path}")
        for err in errors:
            print(f"  - {err}")
        if "JSON Content Mismatch" in errors:
            print("  Django:")
            print(json.dumps(normalize_data(dj_json), indent=2))
            print("  Go:")
            print(json.dumps(normalize_data(go_json), indent=2))
        return False
    else:
        print(f"✅ PASSED: {path}")
        return True

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("method", help="HTTP Method")
    parser.add_argument("path", help="URL path (e.g. /api/instances/)")
    parser.add_argument("--cookie", help="Cookie header value for auth", default="")
    parser.add_argument("--data", help="JSON data string for POST/PATCH", default="{}")
    
    args = parser.parse_args()
    
    headers = {}
    if args.cookie:
        headers["Cookie"] = args.cookie
        
    data = json.loads(args.data) if args.data else None
    
    success = run_contract_test(args.method.upper(), args.path, headers, data)
    if not success:
        sys.exit(1)
