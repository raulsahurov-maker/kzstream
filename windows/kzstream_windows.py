"""
KZStream для Windows.
1) Читает уведомления Windows (Kaspi через «Связь с телефоном» / Phone Link)
   и отправляет входящие переводы на сервер KZStream.
2) Выполняет хоткеи при донатах (тариф Pro).
"""
import asyncio
import json
import os
import re
import sys
import threading
import time
import tkinter as tk
from tkinter import ttk

import requests

try:
    import keyboard  # нажатие клавиш для хоткеев
except Exception:  # pragma: no cover
    keyboard = None

try:
    from winsdk.windows.ui.notifications.management import (
        UserNotificationListener, UserNotificationListenerAccessStatus)
    from winsdk.windows.ui.notifications import NotificationKinds, KnownNotificationBindings
    HAS_WINSDK = True
except Exception:  # pragma: no cover
    HAS_WINSDK = False

APP_DIR = os.path.join(os.environ.get('APPDATA', os.path.expanduser('~')), 'KZStream')
CFG_PATH = os.path.join(APP_DIR, 'config.json')
MONEY = re.compile(r'\d[\d\s  ]*([.,]\d{1,2})?\s*(₸|тг|тенге|KZT)|(₸|KZT)\s*\d', re.I)
LINK_RE = re.compile(r'^(https?://.+)/api/ingest/([A-Za-z0-9_-]+)/?$')


def load_cfg():
    try:
        with open(CFG_PATH, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {'link': '', 'only_banks': True}


def save_cfg(cfg):
    os.makedirs(APP_DIR, exist_ok=True)
    with open(CFG_PATH, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False)


class Worker:
    def __init__(self, log):
        self.log = log
        self.running = False
        self.link = ''
        self.only_banks = True
        self.hotkeys = []
        self.seen = set()

    # ---------- общие ----------
    def base_and_token(self):
        m = LINK_RE.match(self.link)
        return (m.group(1), m.group(2)) if m else (None, None)

    def post(self, body):
        try:
            r = requests.post(self.link, json=body, timeout=8)
            return r.status_code, r.json()
        except Exception as e:
            return 0, {'error': str(e)}

    def start(self, link, only_banks):
        self.link, self.only_banks = link.strip().rstrip('/'), only_banks
        if not LINK_RE.match(self.link):
            self.log('✗ Неверная ссылка. Скопируйте её в кабинете → «Подключение».')
            return False
        code, j = self.post({'ping': 1})
        if code != 200:
            self.log(f'✗ Нет связи с сервером: {j.get("error", code)}')
            return False
        self.log(f'✓ Подключено к аккаунту {j.get("nick")}')
        self.running = True
        threading.Thread(target=self.notif_thread, daemon=True).start()
        threading.Thread(target=self.events_thread, daemon=True).start()
        return True

    def stop(self):
        self.running = False
        self.log('■ Остановлено')

    # ---------- уведомления Windows ----------
    def notif_thread(self):
        if not HAS_WINSDK:
            self.log('! Чтение уведомлений недоступно (нужна Windows 10/11). Хоткеи работают.')
            return
        asyncio.run(self.notif_loop())

    async def notif_loop(self):
        listener = UserNotificationListener.current
        try:
            status = await listener.request_access_async()
        except Exception:
            status = listener.get_access_status()
        if status != UserNotificationListenerAccessStatus.ALLOWED:
            self.log('✗ Нет доступа к уведомлениям. Откройте Параметры → Конфиденциальность → Уведомления '
                     'и разрешите доступ приложениям, затем перезапустите KZStream.')
            return
        self.log('✓ Доступ к уведомлениям есть. Жду переводы…')
        first = True
        while self.running:
            try:
                notifs = await listener.get_notifications_async(NotificationKinds.TOAST)
                for n in notifs:
                    if n.id in self.seen:
                        continue
                    self.seen.add(n.id)
                    if first:
                        continue  # старые уведомления при запуске не отправляем
                    self.handle(n)
                first = False
                if len(self.seen) > 5000:
                    self.seen = set(list(self.seen)[-1000:])
            except Exception as e:
                self.log(f'! Ошибка чтения уведомлений: {e}')
                await asyncio.sleep(5)
            await asyncio.sleep(1)

    def handle(self, n):
        try:
            app = n.app_info.display_info.display_name or ''
        except Exception:
            app = ''
        try:
            binding = n.notification.visual.get_binding(KnownNotificationBindings.toast_generic)
            texts = [t.text for t in binding.get_text_elements()] if binding else []
        except Exception:
            texts = []
        if not texts:
            return
        title, text = texts[0], '\n'.join(texts[1:])
        full = f'{app}\n{title}\n{text}'
        if not MONEY.search(full):
            return
        low = full.lower()
        if self.only_banks and not any(k in low for k in ('kaspi', 'каспи', 'перевод', 'пополнен', 'поступ', 'зачисл', 'halyk')):
            return
        code, j = self.post({'title': title, 'text': text, 'package': app, 'key': f'win-{n.id}'})
        if code == 200 and j.get('donation'):
            d = j['donation']
            self.log(f'💸 Донат: {d["name"]} — {d["amount"]} ₸')
        elif code == 200:
            self.log(f'· Пропущено: {title[:40]}')
        else:
            self.log(f'✗ Ошибка отправки: {j.get("error", code)}')

    # ---------- хоткеи (события с сервера) ----------
    def load_hotkeys(self, base, token):
        try:
            st = requests.get(f'{base}/api/w/{token}/state', timeout=8).json()
            self.hotkeys = st.get('settings', {}).get('hotkeys', []) or []
            if self.hotkeys:
                self.log(f'⌨ Загружено хоткеев: {len(self.hotkeys)}')
        except Exception:
            pass

    def events_thread(self):
        base, token = self.base_and_token()
        self.load_hotkeys(base, token)
        while self.running:
            try:
                with requests.get(f'{base}/api/w/{token}/stream', stream=True, timeout=(8, 60)) as r:
                    event = None
                    for raw in r.iter_lines(decode_unicode=True):
                        if not self.running:
                            return
                        if raw is None:
                            continue
                        if raw.startswith('event:'):
                            event = raw[6:].strip()
                        elif raw.startswith('data:') and event:
                            data = json.loads(raw[5:].strip())
                            if event == 'donation':
                                self.fire_hotkeys(data.get('amount', 0))
                            elif event == 'settings':
                                self.hotkeys = data.get('hotkeys', []) or []
                            event = None
            except Exception:
                time.sleep(3)

    def fire_hotkeys(self, amount):
        for h in self.hotkeys:
            lo, hi = h.get('min', 0), h.get('max', 0)
            if amount >= lo and (not hi or amount <= hi):
                if keyboard is None:
                    self.log('! Модуль клавиатуры недоступен')
                    return
                try:
                    keyboard.send(h['keys'])
                    self.log(f'⌨ Хоткей {h["keys"]} ({amount} ₸)')
                except Exception as e:
                    self.log(f'! Хоткей {h.get("keys")}: {e}')


class App:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title('KZStream')
        self.root.geometry('560x520')
        self.root.configure(bg='#07080d')
        self.cfg = load_cfg()
        self.worker = Worker(self.log)

        st = ttk.Style()
        st.theme_use('clam')
        st.configure('TButton', padding=8, font=('Segoe UI', 10, 'bold'))
        st.configure('TCheckbutton', background='#07080d', foreground='#eef0f7', font=('Segoe UI', 10))

        tk.Label(self.root, text='KZStream', fg='#ff3b5c', bg='#07080d', font=('Segoe UI', 20, 'bold')).pack(anchor='w', padx=18, pady=(16, 0))
        tk.Label(self.root, text='Kaspi-донаты на ваш стрим', fg='#9097ad', bg='#07080d', font=('Segoe UI', 10)).pack(anchor='w', padx=18)
        tk.Label(self.root, text='Ссылка подключения (кабинет → «Подключение»):', fg='#eef0f7', bg='#07080d', font=('Segoe UI', 10)).pack(anchor='w', padx=18, pady=(16, 4))
        self.link = tk.Entry(self.root, font=('Consolas', 10), bg='#12141f', fg='#eef0f7', insertbackground='#fff', relief='flat')
        self.link.pack(fill='x', padx=18, ipady=7)
        self.link.insert(0, self.cfg.get('link', ''))
        self.only = tk.BooleanVar(value=self.cfg.get('only_banks', True))
        ttk.Checkbutton(self.root, text='Только банковские уведомления', variable=self.only).pack(anchor='w', padx=18, pady=8)
        row = tk.Frame(self.root, bg='#07080d')
        row.pack(fill='x', padx=18)
        self.btn = ttk.Button(row, text='▶ Старт', command=self.toggle)
        self.btn.pack(side='left')
        ttk.Button(row, text='Тестовый донат', command=self.test).pack(side='left', padx=8)
        self.box = tk.Text(self.root, bg='#12141f', fg='#cfd3e3', font=('Consolas', 9), relief='flat', state='disabled')
        self.box.pack(fill='both', expand=True, padx=18, pady=14)
        self.log('Подключите телефон через «Связь с телефоном» (Phone Link) и разрешите уведомления Kaspi.')
        if self.cfg.get('link'):
            self.root.after(500, self.toggle)

    def log(self, msg):
        def add():
            self.box.configure(state='normal')
            self.box.insert('1.0', time.strftime('%H:%M:%S  ') + msg + '\n')
            self.box.configure(state='disabled')
        self.root.after(0, add)

    def toggle(self):
        if self.worker.running:
            self.worker.stop()
            self.btn.configure(text='▶ Старт')
            return
        self.cfg = {'link': self.link.get().strip(), 'only_banks': self.only.get()}
        save_cfg(self.cfg)

        def go():
            if self.worker.start(self.cfg['link'], self.cfg['only_banks']):
                self.root.after(0, lambda: self.btn.configure(text='■ Стоп'))
        threading.Thread(target=go, daemon=True).start()

    def test(self):
        def go():
            self.worker.link = self.link.get().strip().rstrip('/')
            code, j = self.worker.post({'title': 'Kaspi.kz', 'text': 'Перевод 1 000 ₸ от Тест Т.', 'key': f'wtest-{time.time()}'})
            self.log('✓ Тестовый донат отправлен' if code == 200 else f'✗ {j.get("error", code)}')
        threading.Thread(target=go, daemon=True).start()

    def run(self):
        self.root.mainloop()


if __name__ == '__main__':
    App().run()
