"""
Прямое подключение iPhone к KZStream по Bluetooth — без «Связи с телефоном».

iPhone отдаёт уведомления сопряжённым устройствам по стандартному протоколу Apple ANCS
(Apple Notification Center Service, BLE). Программа подключается к iPhone как часы/браслет:
  1) программа находит iPhone (сопряжённый в Windows или просто лежащий рядом) и сама
     делает защищённое сопряжение по Bluetooth LE — на iPhone «Создать пару»;
  2) держит соединение открытым, пока на iPhone не нажмут «Разрешить» уведомления
     (раньше соединение рвалось сразу, и запрос на iPhone не успевал появиться);
  3) каждое новое уведомление (Kaspi и т. п.) приходит сюда целиком: приложение, заголовок, текст.
Заодно читается заряд батареи iPhone (стандартная служба Battery 0x180F).
"""
import asyncio
import struct
import threading
import time
import uuid

try:
    from winsdk.windows.devices.bluetooth import (
        BluetoothAdapter, BluetoothCacheMode, BluetoothConnectionStatus, BluetoothDevice, BluetoothLEDevice)
    from winsdk.windows.devices.bluetooth.genericattributeprofile import (
        GattClientCharacteristicConfigurationDescriptorValue as CCCD, GattCommunicationStatus, GattWriteOption)
    from winsdk.windows.devices.enumeration import DeviceInformation
    from winsdk.windows.devices.enumeration import DevicePairingKinds, DevicePairingProtectionLevel, DevicePairingResultStatus
    from winsdk.windows.storage.streams import DataReader, DataWriter
    HAS_BT = True
except Exception:  # pragma: no cover
    HAS_BT = False
try:
    from winsdk.windows.devices.bluetooth.genericattributeprofile import GattSession
except Exception:  # pragma: no cover
    GattSession = None
try:
    from winsdk.windows.devices.bluetooth.advertisement import BluetoothLEAdvertisementWatcher, BluetoothLEScanningMode
except Exception:  # pragma: no cover
    BluetoothLEAdvertisementWatcher = None
try:  # компьютер как Bluetooth-аксессуар: его видно в «Настройки → Bluetooth» на iPhone
    from winsdk.windows.devices.bluetooth.advertisement import BluetoothLEAdvertisementPublisher, BluetoothLEAdvertisementDataSection
    from winsdk.windows.devices.bluetooth.genericattributeprofile import (
        GattServiceProvider, GattServiceProviderAdvertisingParameters, GattLocalCharacteristicParameters,
        GattCharacteristicProperties, GattProtectionLevel)
    HAS_PERIPH = True
except Exception:  # pragma: no cover
    HAS_PERIPH = False
KZ_SVC = uuid.UUID('6b7a5354-7265-616d-0001-4b5a53747265')
KZ_CHR = uuid.UUID('6b7a5354-7265-616d-0002-4b5a53747265')

ANCS = uuid.UUID('7905F431-B5CE-4E99-A40F-4B1E122D00D0')
NOTIF_SRC = uuid.UUID('9FBF120D-6301-42D9-8C58-25E699A21DBD')
CTRL_PT = uuid.UUID('69D1D8F3-45E1-49A8-9821-9BBDFDAAD9D9')
DATA_SRC = uuid.UUID('22EAC6E9-24D6-4BB5-BE44-B36ACE7C7BFB')
BATTERY_SVC = uuid.UUID('0000180f-0000-1000-8000-00805f9b34fb')
BATTERY_LVL = uuid.UUID('00002a19-0000-1000-8000-00805f9b34fb')

APPLE_HINTS = ('iphone', 'ipad')


def _bytes(buf):
    try:
        return bytes(buf)
    except Exception:
        r = DataReader.from_buffer(buf)
        out = bytearray(buf.length)
        r.read_bytes(out)
        return bytes(out)


def _buffer(data):
    w = DataWriter()
    try:
        w.write_bytes(bytes(data))
    except TypeError:
        w.write_bytes(list(data))
    return w.detach_buffer()


def _ok(st):
    return st == GattCommunicationStatus.SUCCESS


class IphoneBT:
    """Работает в своём потоке со своим asyncio-циклом. on_notif(app_id, title, subtitle, message, uid)."""

    def __init__(self, on_notif, on_status, log):
        self.on_notif, self.on_status, self.log = on_notif, on_status, log
        self.loop = None
        self.device_id = None
        self.state = 'off'          # off | no_adapter | connecting | searching | visible | pair | allow | on | lost
        self.pin = ''
        self.adapter_why = ''
        self._session = None
        self.name = ''
        self.battery = None
        self.adapter = None         # True/False/None
        self._adv = None
        self._dev = self._svc = self._cp = None
        self._subs = []
        self._buf = b''
        self._wait = None
        self._q = None
        self._stop = False
        self._gen = 0
        threading.Thread(target=self._run, daemon=True).start()

    # ---------- API для программы (вызывается из любого потока)
    def call(self, coro, timeout=40):
        for _ in range(50):
            if self.loop:
                break
            time.sleep(0.1)
        return asyncio.run_coroutine_threadsafe(coro, self.loop).result(timeout)

    def info(self):
        return {'state': self.state, 'name': self.name, 'battery': self.battery, 'adapter': self.adapter,
                'device': self.device_id, 'supported': HAS_BT, 'pin': self.pin, 'why': self.adapter_why}

    def connect(self, device_id):
        self.device_id = device_id
        self._gen += 1
        if self.loop:
            asyncio.run_coroutine_threadsafe(self._keep(self._gen), self.loop)

    def disconnect(self):
        self.device_id = None
        self._gen += 1
        if self.loop:
            asyncio.run_coroutine_threadsafe(self._close(), self.loop)
        self._set('off')

    # ---------- внутреннее
    def _set(self, st, **kw):
        self.state = st
        for k, v in kw.items():
            setattr(self, k, v)
        try:
            self.on_status(self.info())
        except Exception:
            pass

    def _run(self):
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        self._q = asyncio.Queue()
        self.loop.create_task(self._worker())
        self.loop.run_forever()

    async def check_adapter(self):
        """Есть ли Bluetooth LE и включён ли он. Причину пишем в self.adapter_why — её видно в программе."""
        self.adapter_why = ''
        if not HAS_BT:
            self.adapter, self.adapter_why = False, 'Bluetooth-модуль Windows недоступен'
            return False
        try:
            a = await BluetoothAdapter.get_default_async()
            if a is None:
                self.adapter, self.adapter_why = False, 'На компьютере нет Bluetooth (нужен встроенный или USB-адаптер Bluetooth 5.0)'
            elif not a.is_low_energy_supported:
                self.adapter, self.adapter_why = False, 'Bluetooth компьютера старый, без Bluetooth LE — нужен адаптер Bluetooth 4.0+ (лучше 5.0)'
            else:
                self.adapter = True
                try:
                    r = await a.get_radio_async()
                    if r is not None and int(r.state) != 1:  # 1 = RadioState.On
                        self.adapter, self.adapter_why = False, 'Bluetooth выключен — включите его: Параметры → Bluetooth и устройства'
                except Exception:
                    pass
        except Exception as e:
            self.adapter, self.adapter_why = False, f'Не удалось проверить Bluetooth ({e})'
        return self.adapter

    async def list_devices(self):
        """Сопряжённые устройства (iPhone — первыми)."""
        await self.check_adapter()
        out, seen = [], set()
        for sel_src, kind in ((BluetoothLEDevice, 'le'), (BluetoothDevice, 'classic')):
            try:
                sel = sel_src.get_device_selector_from_pairing_state(True)
                # в winsdk нет варианта с одним параметром: нужен (селектор, доп. свойства)
                items = await DeviceInformation.find_all_async(sel, [])
            except Exception as e:
                self.log(f'Bluetooth: не удалось получить список ({e})')
                continue
            for d in items:
                name = (d.name or '').strip() or 'Без имени'
                key = name.lower()
                if key in seen:
                    continue
                seen.add(key)
                out.append({'id': d.id, 'name': name, 'kind': kind,
                            'apple': any(h in key for h in APPLE_HINTS)})
        out.sort(key=lambda x: (not x['apple'], x['name'].lower()))
        return out

    async def _scan_nearby(self, seconds=12):
        """Ищет ближайший iPhone по рекламе Apple (Nearby Info) — iPhone должен быть разблокирован и рядом."""
        if BluetoothLEAdvertisementWatcher is None:
            return None
        found = {}
        loop = self.loop

        def got(addr, rssi, kind):
            v = found.get(addr)
            if not v or rssi > v[0]:
                found[addr] = (rssi, kind)

        def on_recv(_s, a):
            try:
                for m in a.advertisement.manufacturer_data:
                    if m.company_id != 0x004C:
                        continue
                    b = _bytes(m.data)
                    if b and b[0] in (0x10, 0x0C, 0x0F, 0x07):  # Nearby Info / Handoff / Nearby Action
                        loop.call_soon_threadsafe(got, a.bluetooth_address, a.raw_signal_strength_in_d_bm, b[0])
            except Exception:
                pass
        w = BluetoothLEAdvertisementWatcher()
        try:
            w.scanning_mode = BluetoothLEScanningMode.ACTIVE
        except Exception:
            pass
        tok = w.add_received(on_recv)
        self._set('searching')
        self.log('Ищу iPhone рядом: разблокируйте его и положите рядом с компьютером…')
        w.start()
        try:
            await asyncio.sleep(seconds)
        finally:
            try:
                w.stop()
                w.remove_received(tok)
            except Exception:
                pass
        best = sorted(((r, addr) for addr, (r, k) in found.items() if k == 0x10), reverse=True) \
            or sorted(((r, addr) for addr, (r, _k) in found.items()), reverse=True)
        if not best:
            self.log('iPhone рядом не найден: включите Bluetooth на iPhone, разблокируйте экран и поднесите ближе')
            return None
        rssi, addr = best[0]
        self.log(f'Нашёл iPhone рядом (сигнал {rssi} дБм) — подключаюсь')
        try:
            return await BluetoothLEDevice.from_bluetooth_address_async(addr)
        except Exception:
            return None

    async def _pair(self, dev):
        """Защищённое LE-сопряжение. Без него iPhone не покажет ANCS и запрос «Разрешить уведомления»."""
        try:
            pr = dev.device_information.pairing
            if pr.is_paired:
                return True
            if not pr.can_pair:
                self.log('Bluetooth: iPhone не даёт создать пару — откройте на iPhone Настройки → Bluetooth и держите экран включённым')
                return False
            cp = pr.custom
            loop = self.loop

            def on_req(_s, a):
                try:
                    pin = a.pin or ''
                    if pin:
                        loop.call_soon_threadsafe(lambda: (self._set('pair', pin=pin), self.log(f'На iPhone появится код {pin} — нажмите «Создать пару»')))
                    a.accept()
                except Exception:
                    pass
            tok = cp.add_pairing_requested(on_req)
            self._set('pair', pin='')
            self.log('На iPhone нажмите «Создать пару», затем «Разрешить» уведомления')
            kinds = DevicePairingKinds.CONFIRM_ONLY | DevicePairingKinds.CONFIRM_PIN_MATCH | DevicePairingKinds.DISPLAY_PIN
            try:
                res = await cp.pair_async(kinds, DevicePairingProtectionLevel.ENCRYPTION_AND_AUTHENTICATION)
                if res.status not in (DevicePairingResultStatus.PAIRED, DevicePairingResultStatus.ALREADY_PAIRED):
                    res = await cp.pair_async(kinds, DevicePairingProtectionLevel.ENCRYPTION)
            finally:
                try:
                    cp.remove_pairing_requested(tok)
                except Exception:
                    pass
            self.pin = ''
            ok = res.status in (DevicePairingResultStatus.PAIRED, DevicePairingResultStatus.ALREADY_PAIRED)
            if not ok:
                self.log(f'Bluetooth: пара не создана ({res.status}). Нажмите «Создать пару» на iPhone, когда появится запрос')
            return ok
        except Exception as e:
            self.log(f'Bluetooth: сопряжение не удалось ({e})')
            return False

    def _stop_visible(self):
        a, self._adv = self._adv, None
        if not a:
            return
        for f in (lambda: a[1].stop(), lambda: a[0].stop_advertising()):
            try:
                f()
            except Exception:
                pass

    async def _connected_le(self):
        sel = BluetoothLEDevice.get_device_selector_from_connection_status(BluetoothConnectionStatus.CONNECTED)
        items = await DeviceInformation.find_all_async(sel, [])
        return {d.id: (d.name or '') for d in items}

    async def _wait_visible(self, seconds=240):
        """Компьютер объявляет себя аксессуаром, которому нужны уведомления Apple (ANCS solicitation).
        iPhone показывает его в «Настройки → Bluetooth → Другие устройства»; пользователь нажимает — iPhone
        подключается сам, создаёт пару и спрашивает «Разрешить уведомления?». Так подключаются часы и браслеты."""
        if not HAS_PERIPH:
            self.log('Bluetooth: эта версия Windows не умеет быть видимой для iPhone')
            return None
        self._stop_visible()
        try:
            r = await GattServiceProvider.create_async(KZ_SVC)
            prov = r.service_provider
        except Exception as e:
            prov, r = None, e
        if prov is None:
            self.log(f'Bluetooth: адаптер не умеет быть видимым для iPhone ({getattr(r, "error", r)}) — используйте «Найти iPhone рядом»')
            return None
        try:
            cp = GattLocalCharacteristicParameters()
            cp.characteristic_properties = GattCharacteristicProperties.READ
            cp.read_protection_level = GattProtectionLevel.PLAIN
            cp.static_value = _buffer(b'KZStream')
            await prov.service.create_characteristic_async(KZ_CHR, cp)
        except Exception:
            pass
        ap = GattServiceProviderAdvertisingParameters()
        ap.is_connectable = True
        ap.is_discoverable = True
        try:
            prov.start_advertising_with_parameters(ap)
        except Exception:
            try:
                prov.start_advertising()
            except Exception as e:
                self.log(f'Bluetooth: видимость не включилась ({e})')
                return None
        pub = BluetoothLEAdvertisementPublisher()
        try:  # тип 0x15 — «запрошенные службы»: по нему iPhone понимает, что это аксессуар для уведомлений
            pub.advertisement.data_sections.append(BluetoothLEAdvertisementDataSection(0x15, _buffer(ANCS.bytes[::-1])))
            pub.start()
        except Exception as e:
            self.log(f'Bluetooth: запрос уведомлений в рекламе не включился ({e})')
        self._adv = (prov, pub)
        try:
            before = await self._connected_le()
        except Exception:
            before = {}
        self._set('visible')
        self.log('Компьютер виден для iPhone. На iPhone: Настройки → Bluetooth → внизу «Другие устройства» → '
                 'нажмите на имя этого компьютера → «Создать пару» → «Разрешить» уведомления')
        gen = self._gen
        for _ in range(seconds // 2):
            if gen != self._gen:
                return None
            await asyncio.sleep(2)
            try:
                now = await self._connected_le()
            except Exception:
                continue
            for i in [i for i in now if i not in before]:
                try:
                    dev = await BluetoothLEDevice.from_id_async(i)
                except Exception:
                    dev = None
                if dev is not None:
                    self.log(f'Устройство «{dev.name or now[i] or "iPhone"}» подключилось к компьютеру')
                    return dev
        self.log('Bluetooth: iPhone не подключился за 4 минуты. Нажмите на имя компьютера в «Другие устройства» на iPhone')
        self._stop_visible()
        return None

    async def _open_le(self, device_id):
        if device_id == 'nearby':
            return await self._scan_nearby()
        if device_id == 'visible':
            return await self._wait_visible()
        dev = None
        try:
            dev = await BluetoothLEDevice.from_id_async(device_id)
        except Exception:
            dev = None
        if dev is None:  # выбрано классическое устройство — берём его LE-сторону по адресу
            try:
                c = await BluetoothDevice.from_id_async(device_id)
                if c is not None:
                    dev = await BluetoothLEDevice.from_bluetooth_address_async(c.bluetooth_address)
            except Exception:
                dev = None
        return dev

    async def _close(self):
        for ch, tok in self._subs:
            try:
                ch.remove_value_changed(tok)
            except Exception:
                pass
        self._subs = []
        try:
            if self._dev:
                self._dev.close()
        except Exception:
            pass
        try:
            if self._session:
                self._session.close()
        except Exception:
            pass
        self._session = None
        self._stop_visible()
        self._dev = self._svc = self._cp = None

    async def _keep(self, gen):
        """Держит подключение: при обрыве переподключается сама."""
        await self._close()
        if not HAS_BT:
            return self._set('no_adapter')
        if not await self.check_adapter():
            self.log('Bluetooth: ' + self.adapter_why)
            return self._set('no_adapter')
        fails = 0
        while gen == self._gen and self.device_id:
            try:
                ok = await self._connect_once()
            except Exception as e:
                ok = False
                self.log(f'Bluetooth: {e}')
            if ok:
                fails = 0
                while gen == self._gen and self._dev is not None:
                    try:
                        if self._dev.connection_status != BluetoothConnectionStatus.CONNECTED:
                            raise RuntimeError('lost')
                        await self._read_battery()
                    except Exception:
                        break
                    for _ in range(30):
                        if gen != self._gen:
                            return
                        await asyncio.sleep(1)
                if gen != self._gen:
                    return
                self.log('iPhone отключился — переподключаюсь…')
                self._set('lost')
                await self._close()
            fails += 1
            await asyncio.sleep(5 if fails < 6 else 15)

    async def _connect_once(self):
        self._set('connecting')
        dev = await self._open_le(self.device_id)
        if dev is None and self.device_id not in ('nearby', 'visible'):
            dev = await self._scan_nearby()  # сопряжённый в Windows iPhone не отвечает по LE — ищем его рядом
        if dev is None:
            self.log('Bluetooth: iPhone не найден — проверьте, что он рядом, разблокирован и Bluetooth включён')
            return False
        self._dev = dev
        self.name = dev.name or self.name or 'iPhone'
        try:  # подробности для журнала поддержки (видно на сайте в «Установка»)
            pr = dev.device_information.pairing
            self.log(f'диаг: устройство «{dev.name}», адрес {dev.bluetooth_address:012X}, тип адреса {int(dev.bluetooth_address_type)}, '
                     f'связь {int(dev.connection_status)}, пара LE {pr.is_paired}, можно создать пару {pr.can_pair}')
        except Exception as e:
            self.log(f'диаг: не удалось прочитать устройство ({e})')
        if GattSession is not None:  # держим связь, иначе Windows рвёт её до ответа на iPhone
            try:
                self._session = await GattSession.from_device_id_async(dev.bluetooth_device_id)
                self._session.maintain_connection = True
            except Exception:
                self._session = None
        if not await self._pair(dev):
            await self._close()
            return False
        res = None
        for i in range(36):  # до 3 минут ждём, пока на iPhone нажмут «Разрешить»
            res = await dev.get_gatt_services_for_uuid_async(ANCS, BluetoothCacheMode.UNCACHED)
            if _ok(res.status) and res.services.size:
                break
            if i in (0, 6, 18):
                try:
                    allr = await dev.get_gatt_services_async(BluetoothCacheMode.UNCACHED)
                    uu = [str(allr.services.get_at(k).uuid)[4:8] for k in range(allr.services.size)] if _ok(allr.status) else []
                    self.log(f'диаг: ANCS статус {int(res.status)}, всех служб {len(uu)} ({",".join(uu) or "—"}), '
                             f'связь {int(dev.connection_status)}, пара {dev.device_information.pairing.is_paired}, '
                             f'защита {int(dev.device_information.pairing.protection_level)}')
                except Exception as e:
                    self.log(f'диаг: список служб не получен ({e})')
            if i == 0:
                self._set('allow')
                self.log('На iPhone нажмите «Разрешить» в запросе об уведомлениях. Если запроса нет: '
                         'Настройки → Bluetooth → (i) у компьютера → включите «Показывать уведомления»')
            await asyncio.sleep(5)
        if not res or not _ok(res.status) or res.services.size == 0:
            self.log('Bluetooth: iPhone так и не разрешил уведомления — попробую ещё раз. Если запрос не появляется совсем, '
                     'подключите iPhone через «Связь с телефоном» (Подключение → «Связь с телефоном») — там запрос приходит всегда')
            await self._close()
            return False
        svc = res.services.get_at(0)
        self._svc = svc

        async def ch(u):
            r = await svc.get_characteristics_for_uuid_async(u, BluetoothCacheMode.UNCACHED)
            if not _ok(r.status) or r.characteristics.size == 0:
                raise RuntimeError('ANCS недоступен')
            return r.characteristics.get_at(0)
        ns, cp, ds = await ch(NOTIF_SRC), await ch(CTRL_PT), await ch(DATA_SRC)
        self._cp = cp
        loop = self.loop
        for c, kind in ((ds, 'd'), (ns, 'n')):  # сначала Data Source, потом Notification Source
            tok = c.add_value_changed(lambda s, a, k=kind: loop.call_soon_threadsafe(self._on_value, k, _bytes(a.characteristic_value)))
            self._subs.append((c, tok))
            st = None
            for _ in range(24):
                st = await c.write_client_characteristic_configuration_descriptor_async(CCCD.NOTIFY)
                if _ok(st):
                    break
                self._set('allow')
                await asyncio.sleep(5)
            if not _ok(st):
                # обычно значит «не разрешено» — iPhone покажет запрос на разрешение
                self._set('allow')
                self.log('На iPhone нажмите «Разрешить» в запросе об уведомлениях')
                await self._close()
                return False
        await self._read_battery()
        self._set('on')
        self.log(f'📱 iPhone «{self.name}» подключён по Bluetooth — жду переводы Kaspi')
        return True

    async def _read_battery(self):
        if not self._dev:
            return
        try:
            r = await self._dev.get_gatt_services_for_uuid_async(BATTERY_SVC, BluetoothCacheMode.CACHED)
            if _ok(r.status) and r.services.size:
                cr = await r.services.get_at(0).get_characteristics_for_uuid_async(BATTERY_LVL)
                if _ok(cr.status) and cr.characteristics.size:
                    v = await cr.characteristics.get_at(0).read_value_async(BluetoothCacheMode.UNCACHED)
                    if _ok(v.status):
                        b = _bytes(v.value)
                        if b:
                            old = self.battery
                            self.battery = b[0]
                            if old != self.battery:
                                self._set(self.state)
        except Exception:
            pass

    def _on_value(self, kind, data):
        if kind == 'n':
            if len(data) < 8:
                return
            event, flags, cat, _cnt, uid = struct.unpack('<BBBBI', data[:8])
            if event == 0 and not flags & 0x04:  # новое уведомление (не «старое при подключении»)
                self._q.put_nowait(uid)
        else:
            self._buf += data
            if self._wait and not self._wait.done():
                parsed = self._parse(self._buf)
                if parsed:
                    self._wait.set_result(parsed)

    @staticmethod
    def _parse(b):
        if len(b) < 5 or b[0] != 0:
            return None
        uid = struct.unpack('<I', b[1:5])[0]
        i, attrs = 5, {}
        while len(attrs) < 4:
            if len(b) < i + 3:
                return None
            aid, ln = b[i], struct.unpack('<H', b[i + 1:i + 3])[0]
            if len(b) < i + 3 + ln:
                return None
            attrs[aid] = b[i + 3:i + 3 + ln].decode('utf-8', 'ignore')
            i += 3 + ln
        return uid, attrs

    async def _worker(self):
        while True:
            uid = await self._q.get()
            if not self._cp:
                continue
            self._buf = b''
            self._wait = self.loop.create_future()
            req = bytes([0]) + struct.pack('<I', uid) + bytes([0]) + bytes([1]) + struct.pack('<H', 128) \
                + bytes([2]) + struct.pack('<H', 128) + bytes([3]) + struct.pack('<H', 512)
            try:
                await self._cp.write_value_with_result_async(_buffer(req), GattWriteOption.WRITE_WITH_RESPONSE)
                got = await asyncio.wait_for(self._wait, 5)
            except Exception:
                continue
            _uid, a = got
            try:
                self.on_notif(a.get(0, ''), a.get(1, ''), a.get(2, ''), a.get(3, ''), uid)
            except Exception as e:
                self.log(f'Bluetooth: ошибка обработки ({e})')
