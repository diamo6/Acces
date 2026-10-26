#!/usr/bin/env python3
"""Local dev server for checkin-app — full worker.js replica using SQLite."""
import json
import os
import sys
import sqlite3
import hashlib
import uuid
import time
import http.server
import urllib.parse
from datetime import datetime, timedelta

# Constants from worker.js
TZ_OFFSET = 7 * 3600 * 1000  # Asia/Bangkok
MAX_PHOTO_CHARS = 700_000
MAX_THUMB_CHARS = 120_000
MAX_BODY_CHARS = 900_000
TEAM_CODE = os.environ.get("TEAM_CODE", "LOCAL-TEST-CODE")
DISCORD_WEBHOOK_URL = os.environ.get("DISCORD_WEBHOOK_URL", "https://discord.com/api/webhooks/1551038546960195596/PjU5Vz9jXVfjIQcxHDwdDCdHBvEA2emlNv26zs18Q-u4PImSo8nhCV28h4q7jyMtjgiF")
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'checkin.db')

# Ensure data directory exists
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

def day_key(ms=None):
    """Convert ms timestamp to YYYY-MM-DD in Bangkok timezone."""
    dt = datetime.utcnow() + timedelta(hours=7)
    return dt.strftime('%Y-%m-%d')

def safe_equal(a, b):
    """Timing-safe string comparison."""
    if not isinstance(a, str) or not isinstance(b, str):
        return False
    if len(a) != len(b) or len(a) == 0:
        return False
    return hashlib.sha256(a.encode()).hexdigest() == hashlib.sha256(b.encode()).hexdigest()

def clean_text(v, max_len):
    """Clean and truncate text input."""
    if not isinstance(v, str):
        return ''
    return v.strip()[:max_len]

def is_photo(v):
    """Check if string is a valid base64 JPEG photo."""
    if not isinstance(v, str):
        return False
    return v.startswith('data:image/jpeg;base64,') and len(v) <= MAX_PHOTO_CHARS

def is_thumb(v):
    """Check if string is a valid base64 JPEG thumbnail."""
    if not isinstance(v, str):
        return False
    return v.startswith('data:image/jpeg;base64,') and len(v) <= MAX_THUMB_CHARS

def public_row(row):
    """Convert DB row to public format."""
    return {
        'id': row[0],
        'name': row[1],
        'shift': row[2],
        'status': row[3],
        'workDate': row[4],
        'checkInAt': row[5],
        'checkOutAt': row[6],
        'thumbIn': row[8],
        'thumbOut': row[10]
    }

def init_db():
    """Initialize SQLite database with schema."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute('''CREATE TABLE IF NOT EXISTS attendance (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        shift TEXT,
        status TEXT,
        work_date TEXT NOT NULL,
        check_in_at TEXT NOT NULL,
        check_out_at TEXT,
        photo_in TEXT,
        thumb_in TEXT,
        photo_out TEXT,
        thumb_out TEXT
    )''')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance (work_date)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_attendance_name_date ON attendance (name, work_date)')
    conn.commit()
    return conn

class CheckinHandler(http.server.BaseHTTPRequestHandler):
    conn = None

    def log_message(self, format, *args):
        pass  # Silence logs

    def send_json(self, data, status=200, headers=None):
        body = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        if headers:
            for k, v in headers.items():
                self.send_header(k, v)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        """Read and parse JSON body."""
        length = int(self.headers.get('Content-Length', 0))
        if length == 0:
            return None
        if length > MAX_BODY_CHARS:
            return {'error': 'body_too_large'}
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw)
            if not isinstance(data, dict):
                return {'error': 'bad_request'}
            return {'data': data}
        except:
            return {'error': 'bad_request'}

    def check_auth(self):
        """Check team code authentication."""
        code = self.headers.get('x-team-code', '')
        if not safe_equal(code, TEAM_CODE):
            self.send_json({'error': 'unauthorized'}, 401)
            return False
        return True

    def do_GET(self):
        """Handle GET requests."""
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        params = urllib.parse.parse_qs(parsed.query)

        # Serve static files
        if not path.startswith('/api/'):
            if path == '/' or path == '/index.html':
                self.serve_static('index.html', 'text/html')
            elif path == '/styles.css':
                self.serve_static('styles.css', 'text/css')
            elif path == '/acccs.ico':
                self.serve_static('acccs.ico', 'image/x-icon')
            else:
                self.serve_static(path.lstrip('/'), 'application/octet-stream')
            return

        # Auth check
        if not self.check_auth():
            return

        # /api/attendance GET
        if path == '/api/attendance':
            self.handle_get_attendance(params)
        # /api/recent GET
        elif path == '/api/recent':
            self.handle_get_recent(params)
        # /api/attendance/:id GET
        elif path.startswith('/api/attendance/') and '/checkout' not in path:
            record_id = urllib.parse.unquote(path.split('/')[-1])
            self.handle_get_record(record_id)
        else:
            self.send_json({'error': 'not_found'}, 404)

    def do_POST(self):
        """Handle POST requests."""
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # /api/session POST — no auth header required, body code is the auth
        if path == '/api/session':
            body = self.read_body()
            if body and body.get('error'):
                status = 413 if body['error'] == 'body_too_large' else 400
                self.send_json({'error': body['error']}, status)
                return
            self.handle_session(body)
            return

        # Check auth for all other POST endpoints
        if not self.check_auth():
            return

        body = self.read_body()
        if body and body.get('error'):
            status = 413 if body['error'] == 'body_too_large' else 400
            self.send_json({'error': body['error']}, status)
            return

        # /api/attendance POST
        if path == '/api/attendance':
            self.handle_post_attendance(body)
        # /api/attendance/:id/checkout POST
        elif path.endswith('/checkout'):
            record_id = urllib.parse.unquote(path.split('/')[-2])
            self.handle_checkout(record_id, body)
        # /api/notify/discord — simulate Discord webhook
        elif path == '/api/notify/discord':
            self.handle_notify_discord(body)
        # /api/notify/teams — simulate Teams webhook
        elif path == '/api/notify/teams':
            self.handle_notify_teams(body)
        else:
            self.send_json({'error': 'not_found'}, 404)

    def handle_get_attendance(self, params):
        """Handle GET /api/attendance with optional date filter or date range."""
        all_param = params.get('all', [None])[0]
        
        if all_param == '1':
            # Date range query
            from_date = params.get('from', [None])[0]
            to_date = params.get('to', [None])[0]
            
            sql = 'SELECT * FROM attendance'
            where_params = []
            
            if from_date or to_date:
                sql += ' WHERE 1=1'
                if from_date:
                    sql += ' AND work_date >= ?'
                    where_params.append(from_date)
                if to_date:
                    sql += ' AND work_date <= ?'
                    where_params.append(to_date)
            
            sql += ' ORDER BY work_date DESC, check_in_at DESC'
            
            try:
                self.conn.execute('BEGIN')
                results = self.conn.execute(sql, where_params).fetchall()
                self.conn.commit()
                self.send_json({'records': [public_row(r) for r in results]})
            except sqlite3.Error as e:
                self.send_json({'error': str(e)}, 500)
        else:
            # Single day query
            date = params.get('date', [None])[0]
            if not date or not all(c in '0123456789-' for c in date) or len(date) != 10:
                date = day_key()
            
            sql = 'SELECT * FROM attendance WHERE work_date = ? ORDER BY check_in_at ASC'
            try:
                self.conn.execute('BEGIN')
                results = self.conn.execute(sql, [date]).fetchall()
                self.conn.commit()
                self.send_json({'date': date, 'records': [public_row(r) for r in results]})
            except sqlite3.Error as e:
                self.send_json({'error': str(e)}, 500)

    def handle_get_recent(self, params):
        """Handle GET /api/recent."""
        limit = int(params.get('limit', [20])[0])
        limit = max(1, min(100, limit))
        
        sql = 'SELECT * FROM attendance ORDER BY check_in_at DESC LIMIT ?'
        try:
            self.conn.execute('BEGIN')
            results = self.conn.execute(sql, [limit]).fetchall()
            self.conn.commit()
            self.send_json({'records': [public_row(r) for r in results]})
        except sqlite3.Error as e:
            self.send_json({'error': str(e)}, 500)

    def handle_get_record(self, record_id):
        """Handle GET /api/attendance/:id."""
        sql = 'SELECT * FROM attendance WHERE id = ?'
        try:
            self.conn.execute('BEGIN')
            row = self.conn.execute(sql, [record_id]).fetchone()
            self.conn.commit()
            if row:
                self.send_json({'record': public_row(row)})
            else:
                self.send_json({'error': 'not_found'}, 404)
        except sqlite3.Error as e:
            self.send_json({'error': str(e)}, 500)

    def handle_session(self, body):
        """Handle POST /api/session for authentication."""
        # body from read_body is {'data': <parsed_json>}, so body.get('data') gives the parsed JSON
        # which is {'code': 'LOCAL-TEST-CODE'}
        # But read_body returns {'data': raw_parsed_json}, and the frontend sends {"data": {"code": "..."}}
        # So body.get('data') = {'code': '...'} when the frontend sends {"code": "..."}
        # Or body.get('data') = {'data': {'code': '...'}} when frontend sends {"data": {"code": "..."}}
        # In our case the frontend sends {"data": {"code": "LOCAL-TEST-CODE"}}
        # read_body parses it to data = {"data": {"code": "LOCAL-TEST-CODE"}}
        # then returns {'data': data} = {'data': {"data": {"code": "LOCAL-TEST-CODE"}}}
        # So body.get('data') = {"data": {"code": "LOCAL-TEST-CODE"}}
        # Then body.get('data').get('data').get('code') = 'LOCAL-TEST-CODE'
        inner = body.get('data', {}) if isinstance(body, dict) else {}
        if isinstance(inner, dict) and 'data' in inner:
            inner = inner['data']
        code = clean_text(inner.get('code', ''), 200)
        
        if safe_equal(code, TEAM_CODE):
            self.send_json({'ok': True})
        else:
            self.send_json({'error': 'unauthorized'}, 401)

    def handle_notify_discord(self, body):
        """Handle POST /api/notify/discord — server-side Discord webhook dispatch."""
        if not DISCORD_WEBHOOK_URL:
            self.send_json({'error': 'webhook_not_configured'}, 500)
            return
        
        # Parse nested data payload
        data = body.get('data', body) if isinstance(body, dict) else {}
        if 'data' in data and isinstance(data['data'], dict):
            data = data['data']
        
        embed = data.get('embed') or data.get('embeds', [{}])[0]
        image_url = data.get('image', '')
        username = data.get('username', 'NOC Check-in System')
        avatar_url = data.get('avatar_url', '')
        
        payload = {}
        if username:
            payload['username'] = username
        if avatar_url:
            payload['avatar_url'] = avatar_url
        if embed:
            # Move image to embed (Discord API requires it inside embed)
            if image_url:
                embed['image'] = {'url': image_url}
            # Clean empty fields
            embed.pop('image', None) if not embed.get('image') else embed.get('image', None)
            payload['embeds'] = [embed]
        elif not payload.get('embeds'):
            self.send_json({'error': 'missing_fields'}, 400)
            return
        
        # Actually send to Discord
        import requests
        try:
            r = requests.post(DISCORD_WEBHOOK_URL, json=payload, timeout=10)
            if r.status_code == 204 or r.ok:
                self.send_json({'ok': True})
            else:
                self.send_json({'error': 'discord_failed', 'status': r.status_code, 'body': r.text[:200]}, 502)
        except Exception as e:
            self.send_json({'error': 'send_failed', 'detail': str(e)}, 502)

    def handle_notify_teams(self, body):
        """Handle POST /api/notify/teams — server-side Teams webhook dispatch."""
        data = body.get('data', body) if isinstance(body, dict) else {}
        card = data.get('card') or data.get('body')
        if card:
            self.send_json({'ok': True})
        else:
            self.send_json({'error': 'missing_fields'}, 400)

    def handle_post_attendance(self, body):
        """Handle POST /api/attendance for check-in."""
        data = body.get('data', {})
        name = clean_text(data.get('name', ''), 80)
        shift = clean_text(data.get('shift', ''), 40)
        status = clean_text(data.get('status', ''), 40)
        photo = data.get('photo')
        thumb = data.get('thumb')
        
        # Validate
        if not name or not shift or not status:
            self.send_json({'error': 'missing_fields'}, 400)
            return
        
        if not is_photo(photo):
            self.send_json({'error': 'bad_photo'}, 400)
            return
        
        if not is_thumb(thumb):
            self.send_json({'error': 'bad_thumb'}, 400)
            return
        
        # Check if already checked in today
        work_date = day_key()
        now = time.time() * 1000
        
        try:
            self.conn.execute('BEGIN')
            open_check = self.conn.execute(
                'SELECT id FROM attendance WHERE name = ? AND work_date = ? AND check_out_at IS NULL LIMIT 1',
                [name, work_date]
            ).fetchone()
            
            if open_check:
                self.conn.rollback()
                self.send_json({'error': 'already_checked_in', 'id': open_check[0]}, 409)
                return
            
            # Insert new record
            record_id = str(uuid.uuid4())
            check_in_at = (datetime.utcnow() + timedelta(hours=7)).isoformat()
            
            self.conn.execute(
                'INSERT INTO attendance (id, name, shift, status, work_date, check_in_at, photo_in, thumb_in) '
                'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [record_id, name, shift, status, work_date, check_in_at, photo, thumb]
            )
            self.conn.commit()
            
            # Fetch the inserted row
            row = self.conn.execute('SELECT * FROM attendance WHERE id = ?', [record_id]).fetchone()
            self.send_json({'record': public_row(row)}, 201)
        except sqlite3.Error as e:
            self.conn.rollback()
            self.send_json({'error': str(e)}, 500)

    def handle_checkout(self, record_id, body):
        """Handle POST /api/attendance/:id/checkout."""
        data = body.get('data', {})
        photo = data.get('photo')
        thumb = data.get('thumb')
        
        # Validate photos
        if not is_photo(photo):
            self.send_json({'error': 'bad_photo'}, 400)
            return
        
        if not is_thumb(thumb):
            self.send_json({'error': 'bad_thumb'}, 400)
            return
        
        try:
            self.conn.execute('BEGIN')
            
            # Get the record
            row = self.conn.execute('SELECT * FROM attendance WHERE id = ?', [record_id]).fetchone()
            if not row:
                self.conn.rollback()
                self.send_json({'error': 'not_found'}, 404)
                return
            
            # Check if already checked out
            if row[6]:  # check_out_at
                self.conn.rollback()
                self.send_json({'error': 'already_checked_out', 'record': public_row(row)}, 409)
                return
            
            # Check if today
            work_date = day_key()
            if row[4] != work_date:  # work_date
                self.conn.rollback()
                self.send_json({'error': 'not_today'}, 409)
                return
            
            # Update checkout
            now = datetime.utcnow() + timedelta(hours=7)
            check_out_at = now.isoformat()
            
            self.conn.execute(
                'UPDATE attendance SET check_out_at = ?, photo_out = ?, thumb_out = ? WHERE id = ? AND check_out_at IS NULL',
                [check_out_at, photo, thumb, record_id]
            )
            self.conn.commit()
            
            # Fetch updated row
            updated = self.conn.execute('SELECT * FROM attendance WHERE id = ?', [record_id]).fetchone()
            self.send_json({'record': public_row(updated)})
        except sqlite3.Error as e:
            self.conn.rollback()
            self.send_json({'error': str(e)}, 500)

    def serve_static(self, filename, content_type):
        """Serve static files."""
        filepath = os.path.join(os.path.dirname(os.path.abspath(__file__)), filename)
        try:
            with open(filepath, 'rb') as f:
                content = f.read()
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(content)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(content)
        except FileNotFoundError:
            self.send_response(404)
            self.end_headers()

if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    # Initialize database
    conn = init_db()
    CheckinHandler.conn = conn
    print(f"  Database: {DB_PATH}")
    
    # Start server
    PORT = 8080
    server = http.server.HTTPServer(('0.0.0.0', PORT), CheckinHandler)
    print(f"  Local dev server: http://127.0.0.1:{PORT}")
    print(f"  Team code: {TEAM_CODE}")
    print(f"  Open http://127.0.0.1:{PORT}")
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Server stopped.")
        conn.close()
