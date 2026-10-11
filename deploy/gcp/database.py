#!/usr/bin/env python3
"""Create the application database/user and store URLs without printing secrets.

Run after Cloud SQL and Memorystore report RUNNABLE/READY. Passwords are
generated locally and delivered through API request bodies, not CLI arguments.
"""
import argparse
import json
import secrets
import subprocess
import urllib.parse
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--region", default="asia-south2")
    args = parser.parse_args()

    def run(command, check=True, data=None):
        result = subprocess.run(["gcloud", *command, f"--project={args.project}", "--quiet"], input=data, text=True, capture_output=True)
        if check and result.returncode:
            raise RuntimeError(result.stderr)
        return result

    sql = json.loads(run(["sql", "instances", "describe", "gte-db", "--format=json"]).stdout)
    redis = json.loads(run(["redis", "instances", "describe", "gte-redis", f"--region={args.region}", "--format=json"]).stdout)
    if sql["state"] != "RUNNABLE" or redis["state"] != "READY":
        raise SystemExit(f"Shared services not ready: SQL={sql['state']}, Redis={redis['state']}")
    databases = json.loads(run(["sql", "databases", "list", "--instance=gte-db", "--format=json"]).stdout)
    if not any(d["name"] == "gte" for d in databases):
        run(["sql", "databases", "create", "gte", "--instance=gte-db"])
    versions = json.loads(run(["secrets", "versions", "list", "gte-database-url", "--filter=state:ENABLED", "--format=json"]).stdout)
    if versions:
        database_url = run(["secrets", "versions", "access", "latest", "--secret=gte-database-url"]).stdout.strip()
        password = urllib.parse.unquote(urllib.parse.urlparse(database_url).password)
    else:
        password = secrets.token_urlsafe(48)
        database_url = f"postgres://gte:{password}@127.0.0.1:5432/gte?sslmode=disable"
        # Persist before creating the SQL user so an interrupted run recovers
        # the same password and never leaves an unreachable application user.
        run(["secrets", "versions", "add", "gte-database-url", "--data-file=-"], data=database_url)
    users = json.loads(run(["sql", "users", "list", "--instance=gte-db", "--format=json"]).stdout)
    exists = any(u["name"] == "gte" for u in users)
    token = run(["auth", "print-access-token"]).stdout.strip()
    url = f"https://sqladmin.googleapis.com/sql/v1beta4/projects/{args.project}/instances/gte-db/users"
    if exists:
        url += "?name=gte"
    request = urllib.request.Request(url, data=json.dumps({"name": "gte", "password": password}).encode(), method="PUT" if exists else "POST", headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=60) as response:
        operation = json.load(response)
    run(["sql", "operations", "wait", operation["name"], "--timeout=300"])
    auth = run(["redis", "instances", "get-auth-string", "gte-redis", f"--region={args.region}", "--format=value(authString)"]).stdout.strip()
    redis_url = f"redis://:{urllib.parse.quote(auth, safe='')}@{redis['host']}:{redis['port']}"
    versions = json.loads(run(["secrets", "versions", "list", "gte-redis-url", "--filter=state:ENABLED", "--format=json"]).stdout)
    previous = run(["secrets", "versions", "access", "latest", "--secret=gte-redis-url"]).stdout.strip() if versions else None
    if previous != redis_url:
        run(["secrets", "versions", "add", "gte-redis-url", "--data-file=-"], data=redis_url)
    print("Application database/user ready; database and Redis URLs stored in Secret Manager.")


if __name__ == "__main__":
    main()
