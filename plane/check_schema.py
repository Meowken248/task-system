from django.db import connection
with connection.cursor() as c:
    c.execute("SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_name='states' ORDER BY ordinal_position")
    for r in c.fetchall():
        print(r)
