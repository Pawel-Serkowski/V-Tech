# Earth-to-Moon Routing: Problemy i Brakujące Elementy

## 🔴 KRYTYCZNE PROBLEMY

### 1. **Brak faktyczności dostarczenia pakietu do destynacji**
**Lokacja**: `backend/worker/worker.py` (linia ~450)

Gdy pakiet osiąga ostatni hop (destination node), worker oznacza go jako `DELIVERED`, ale:
- ❌ Nie ma żadnego mechanizmu faktycznego dostarczenia danych
- ❌ Destination node nie receive'uje pakietu w żaden sposób
- ❌ Brak API endpoint'u `/api/packets/{packet_id}/deliver` lub podobnego
- ❌ Pakiet tylko "znika" z systemu

**Rozwiązanie**: Zaimplementować dedykowany endpoint do faktycznego dostarczenia i callback do destination node'a.

---

### 2. **Brak walidacji połączeń link'ów między węzłami**
**Lokacja**: `backend/app/cgr.py` - funkcja `_collect_neighbors()`

Problem w logice:
```python
if "links" in current_node:
    # ✅ Zwraca tylko skonfigurowane linki
else:
    # ❌ FALLBACK: zwraca WSZYSTKIE inne węzły jako sąsiadów!
    return [node_id for node_id in node_map if node_id != current_node_id]
```

**Konsekwencje**:
- Router planuje trasy przez węzły bez faktycznych połączeń
- Pakiet może być routing'owany przez niezdefiniowane linki
- Brak sprawdzenia asymetrii: A→B nie oznacza B→A

**Rozwiązanie**: 
- Usunąć fallback - wymagać jawnego zdefiniowania wszystkich linków
- Sprawdzać bidirectional connectivity (A→B AND B→A)

---

### 3. **Nieserialny dostęp do CGR podczas retry engine'u**
**Lokacja**: `backend/app/retry_engine.py` (linia ~90-110)

Podczas recalculate route'ów dla `WAITING_RETRY` pakietów:
- ❌ Nie sprawdza się czy contact windows zawierają aktualny czas
- ❌ Contact plan jest budowany z przeszłych okien
- ❌ Nie ma synchronizacji między `earth_timestamp` a rzeczywistym czasem systemu

**Problem**: Node A może być w ruchu, a CGR planuje trasę korzystając ze statycznych contact windows z przeszłości.

---

## 🟠 POWAŻNE BRAKI

### 4. **Brak Time Window Validation w CGR**
**Lokacja**: `backend/app/cgr.py` - `_build_contacts_for_nodes()`

```python
if not start or not end or end < current_time:  # ✅ Sprawdza przeszłość
    continue
```

Problem: ✅ To jest w porządku, ale brakuje:
- ❌ Upewnienia się że pakiet RZECZYWIŚCIE będzie transmitowany w oknie
- ❌ Symulacji opóźnień transmisji relatywnie do rzeczywistych czasów
- ❌ Uwzględnienia jitter'u i losowych opóźnień

---

### 5. **Brak "Store-and-Forward" HDT (Handling/Delay Tolerance)**
**Lokacja**: Brak implementacji

DTN powinien mieć:
- ❌ Buforowanie pakietów na węzłach bez aktywnych połączeń
- ❌ Strategia FIFO/Priority queuing na każdym węźle
- ❌ Callback z każdego intermediate node'a z potwierdeniem przyjęcia
- ❌ Fragmentacja pakietów dla długich tras

**Aktualnie**: Pakiety idą "na żywo" - jeśli nikt nie odbiera, gina.

---

### 6. **Brak rewersji route'u (Reply Path)**
**Lokacja**: Brak w całym systemie

Brakuje:
- ❌ Mechanizmu żeby węzeł destination mógł odpowiedzieć
- ❌ Reverse route computation
- ❌ Tracking "virtual circuits" dla bidirectional flows

---

### 7. **Worker nie śledzi rzeczywistego stanu węzła**
**Lokacja**: `backend/worker/worker.py` (linia ~250)

```python
if current_node != NODE_ID:
    print(f"[worker:{NODE_ID}] packet {packet_id} expected node {current_node}; processing anyway")
```

Problem:
- ❌ Worker PROCES się uruchamia dla NODE_ID, ale obsługuje pakiety z bieżnym węzłem
- ❌ Pakiet może "przejść" przez węzeł bez rzeczywistego przetworzenia
- ❌ Brak syntetyzacji że pakiet NAJrzeczywiscie dotarł do danego węzła

---

## 🟡 ŚREDNIE BRAKI

### 8. **Brak obsługi Link Failures i Recovery**
**Lokacja**: Brak całkowicie

Brakuje:
- ❌ Symulacji awarii linków (link outage)
- ❌ Recovery strategy przy utracie pakietu
- ❌ Exponential backoff przy retry'u
- ❌ Alternative route computation po failover'ze

Aktualnie: Jeśli transmisja się nie uda, pakiet jest CANCELLED lub EXPIRED.

---

### 9. **Brak Congestion Control**
**Lokacja**: Brak całkowicie

- ❌ Brak ograniczenia liczby pakietów w każdym HOP
- ❌ Brak backpressure mechanism'u
- ❌ Worker może być zalewany pakietami bez kontroli

---

### 10. **TTL się nie zmniejsza między hopami**
**Lokacja**: `backend/worker/worker.py` (linia ~300-310)

```python
"ttl_seconds": data.get("ttl_seconds"),  # ← Zawsze to samo!
```

Problem:
- ❌ TTL powinien być zmniejszany o czas transmisji/przetwarzania
- ❌ Pakiet niezależnie od trasy / opóźnień zawsze ma to samo TTL
- ❌ Nie symuluje rzeczywistych ograniczeń wiekowych pakietu

---

### 11. **Brak fragmentacji pakietów**
**Lokacja**: Brak całkowicie

DTN powinien obsługiwać:
- ❌ Fragmentację dużych pakietów
- ❌ Reassembly na destination
- ❌ Out-of-order fragment delivery

---

## 🔵 MNIEJSZE BRAKI

### 12. **Brak metryki Quality-of-Service (QoS)**
Brakuje:
- ❌ BER (Bit Error Rate)
- ❌ Link bandwidth constraints
- ❌ Channel utilization tracking

### 13. **Brak Node-to-Node Authentication**
- ❌ Weryfikacja że worker rzeczywiście reprezentuje węzeł
- ❌ Cryptographic handshake

### 14. **Brak Logging/Telemetry**
- ❌ Brak wysyłania telemetrii z worker'a
- ❌ Brak monitoring'u realtime obciążenia linków

---

## 📊 TABELA FUNKCJONALNOŚCI

| Funkcjonalność | Status | Priorytet |
|---|---|---|
| Packet Ingestion | ✅ Działa | - |
| CGR Routing | ✅ Działa (z zastrzeżeniami) | 🔴 |
| Worker Processing | ✅ Działa (niezupełnie) | 🔴 |
| Delivery Mechanism | ❌ Brakuje | 🔴 🔴 🔴 |
| Link Validation | ❌ Brakuje | 🔴 |
| Store-and-Forward | ❌ Brakuje | 🔴 |
| Retry Logic | ✅ Działa | 🟡 |
| TTL Decrementation | ❌ Brakuje | 🟡 |
| Link Failure Recovery | ❌ Brakuje | 🟡 |
| Congestion Control | ❌ Brakuje | 🟡 |
| Reply Paths | ❌ Brakuje | 🟡 |
| Fragment Reassembly | ❌ Brakuje | 🟡 |

---

## 🛠️ FLOW YANG NIE DZIAŁA PRAWIDŁOWO

```
[EARTH GATEWAY] 
    ↓ (CGR planuje trasę: EARTH → SAT1 → SAT2 → MOON)
    ↓ (Brak sprawdzenia czy SAT1 i SAT2 są faktycznie połączone!)
[SAT1 - Worker]
    ↓ (Paczka przychodzi, ale... czy SAT1 ja rzeczywiście RECEIVER'uje?)
    ↓ (Worker czeka `_delay_seconds()` - to jest SYMULACJA opóźnienia)
    ↓ (Wysyła do SAT2 bez potwierdzenia że SAT1 faktycznie zaakceptował)
[SAT2 - Worker]
    ✅ Potem wysyła do destynacji...
[MOON]
    ❌ ← Nic się nie dzieje! Delivery mechanism brakuje!
```

---

## ✅ REKOMENDACJE (By Order of Importance)

1. **[CRITICAL]** Zaimplementować Delivery Endpoint
2. **[CRITICAL]** Usunąć fallback do all-neighbors w CGR
3. **[CRITICAL]** Dodać Node-to-Queue mapping z worker'a
4. **[IMPORTANT]** TTL decrementation między hopami
5. **[IMPORTANT]** Link validation (bidirectional check)
6. **[IMPORTANT]** Store-and-Forward buffering
7. **[MEDIUM]** Link failure simulation
8. **[MEDIUM]** Congestion control
