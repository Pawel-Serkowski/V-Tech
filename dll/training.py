import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader
import torch.nn.utils.prune as prune
import os

from CNN import SatelliteCloudCNN
from DataSet import Cloud95Dataset 

# --- KONFIGURACJA ---
TARGET_ACCURACY = 0.91  # Nasz cel: 91%
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

def calculate_accuracy(model, loader):
    """Pomocnicza funkcja do sprawdzania skuteczności."""
    model.eval()
    correct = 0
    total = 0
    with torch.no_grad():
        for images, labels in loader:
            images, labels = images.to(DEVICE), labels.to(DEVICE)
            outputs = model(images)
            _, predicted = torch.max(outputs.data, 1)
            total += labels.size(0)
            correct += (predicted == labels).sum().item()
    return correct / total

# 1. Inicjalizacja danych i modelu
DATA_PATH = "./95cloud_dataset"
dataset = Cloud95Dataset(base_folder=DATA_PATH)
dataloader = DataLoader(dataset, batch_size=16, shuffle=True)

model = SatelliteCloudCNN().to(DEVICE)
criterion = nn.CrossEntropyLoss()
optimizer = optim.Adam(model.parameters(), lr=0.001)

# ==========================================
# ETAP 1: ROZGRZEWKA (ZWYKŁY TRENING)
# ==========================================
print(f"--- ETAP 1: Trening (Cel: {TARGET_ACCURACY*100}%) ---")
warmup_epochs = 10 # Zwiększyłem limit, bo Early Stopper i tak nas zatrzyma

for epoch in range(warmup_epochs):
    model.train()
    running_loss = 0.0
    for batch_images, batch_labels in dataloader:
        batch_images, batch_labels = batch_images.to(DEVICE), batch_labels.to(DEVICE)
        optimizer.zero_grad()
        predictions = model(batch_images)
        loss = criterion(predictions, batch_labels)
        loss.backward()
        optimizer.step()
        running_loss += loss.item()
    
    # SPRAWDZANIE ACCURACY
    epoch_acc = calculate_accuracy(model, dataloader)
    print(f"Epoka {epoch+1} | Loss: {running_loss/len(dataloader):.4f} | Acc: {epoch_acc:.2%}")
    
    if epoch_acc >= TARGET_ACCURACY:
        print(f"🎯 Osiągnięto cel {TARGET_ACCURACY*100}%! Zatrzymuję Etap 1.")
        break

# ==========================================
# ETAP 2: ITERATYWNY PRUNING STRUKTURALNY
# ==========================================
print("\n--- ETAP 2: Iteracyjny Pruning ---")
pruning_iterations = 3 
prune_amount = 0.20 

for i in range(pruning_iterations):
    print(f"\n[Cięcie {i+1}/{pruning_iterations}]")
    
    # KROK A: Pruning
    prune.ln_structured(model.conv1, name="weight", amount=prune_amount, n=1, dim=0)
    prune.ln_structured(model.conv2, name="weight", amount=prune_amount, n=1, dim=0)
    
    # KROK B: Douczanie (Fine-tuning) z Early Stopperem
    # Po wycięciu filtrów accuracy spadnie, douczamy model aż znów wróci do formy
    model.train()
    for ft_epoch in range(5): # Max 5 epok douczania na każdą iterację
        for batch_images, batch_labels in dataloader:
            batch_images, batch_labels = batch_images.to(DEVICE), batch_labels.to(DEVICE)
            optimizer.zero_grad()
            loss = criterion(model(batch_images), batch_labels)
            loss.backward()
            optimizer.step()
        
        current_acc = calculate_accuracy(model, dataloader)
        print(f"   Fine-tuning Epoka {ft_epoch+1} | Acc: {current_acc:.2%}")
        
        if current_acc >= TARGET_ACCURACY:
            print(f"   ✅ Model odzyskał sprawność ({current_acc:.2%}). Idę do kolejnego cięcia.")
            break

# ==========================================
# ETAP 3: FINALIZACJA
# ==========================================


prune.remove(model.conv1, 'weight')
prune.remove(model.conv2, 'weight')
torch.save(model.state_dict(), "cloud_model_final_quantized.pth")

import torch.quantization

# 1. Przenosimy model na CPU (Kwantyzacja int8 najlepiej działa na procesorach)
model.to('cpu')
model.eval()

# 2. "Fuzja" warstw (Fusion)
# Łączymy Conv + ReLU, żeby przyspieszyć obliczenia
# Musisz podać nazwy warstw, które masz w klasie SatelliteCloudCNN
modules_to_fuse = [['conv1', 'relu1'], ['conv2', 'relu2']] 
# ^ Dopasuj te nazwy do tego, co masz w main.py!
model_fused = torch.quantization.fuse_modules(model, modules_to_fuse)

# 3. Konfiguracja kwantyzacji
model_fused.qconfig = torch.quantization.get_default_qconfig('fbgemm') # 'fbgemm' dla x86, 'qnnpack' dla ARM/Mobile

# 4. Przygotowanie do kalibracji
model_prepared = torch.quantization.prepare(model_fused)

# 5. KALIBRACJA (Bardzo ważne!)
# Model musi "zobaczyć" trochę realnych danych, żeby wiedzieć, jak przeskalować wagi
print("Trwa kalibracja kwantyzacji...")
with torch.no_grad():
    for i, (images, _) in enumerate(dataloader):
        model_prepared(images)
        if i >= 10: break # Wystarczy kilka paczek danych

# 6. KONWERSJA
model_int8 = torch.quantization.convert(model_prepared)

print("Kwantyzacja zakończona!")
torch.save(model_int8.state_dict(), "cloud_model_int8.pth")


print("\nGotowe. Model odchudzony, skuteczny i zapisany!")