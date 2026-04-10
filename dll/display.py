import torch
import torch.quantization
import os
from torch.utils.data import DataLoader

# Importujemy Twoją sieć i dane
# (Upewnij się, że nazwy plików zgadzają się z Twoimi - np. main.py czy CNN.py)
from CNN import SatelliteCloudCNN 
from DataSet import Cloud95Dataset 

# Tutaj załóżmy, że funkcje, które mi wkleiłeś, są w plikach:
from size_acc import get_model_size, evaluate_accuracy
from confusion_matrix import show_confusion_matrix

# --- KONFIGURACJA ---
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
DATA_PATH = "./95cloud_dataset"

# Nazwy Twoich zapisanych plików z modelami
FILE_FLOAT32 = "cloud_model_final_quantized.pth" 
FILE_INT8 = "cloud_model_int8.pt"  # <-- Zmienione rozszerzenie!              # Model po kwantyzacji

print("Ładowanie danych...")
dataset = Cloud95Dataset(base_folder=DATA_PATH)
dataloader = DataLoader(dataset, batch_size=16, shuffle=False)

print("\n" + "="*50)
print(" ROZPOCZYNAMY TESTY MODELI ")
print("="*50)

# =========================================================
# 1. POBRANIE I TEST MODELU ZWYKŁEGO (FLOAT32)
# =========================================================
print(f"\n---> Ładuję model bazowy z pliku: {FILE_FLOAT32}")
if os.path.exists(FILE_FLOAT32):
    model_float = SatelliteCloudCNN().to(DEVICE)
    # Wczytujemy wagi z dysku
    model_float.load_state_dict(torch.load(FILE_FLOAT32, weights_only=True))
    model_float.eval() # Tryb testowy
    
    # Odpalamy Twoje funkcje:
    get_model_size(model_float, "Zwykły Model (Float32)")
    evaluate_accuracy(model_float, dataloader, DEVICE)
    show_confusion_matrix(model_float, dataloader, DEVICE, title_suffix="Float32")
else:
    print(f"BŁĄD: Nie widzę pliku {FILE_FLOAT32}. Upewnij się, że nazwa jest poprawna.")


# =========================================================
# 2. POBRANIE I TEST MODELU SKWANTYZOWANEGO (INT8)
# =========================================================
print(f"\n---> Ładuję model skwantyzowany z pliku: {FILE_INT8}")
if os.path.exists(FILE_INT8):
    # Krok 1: Wczytanie całej kapsuły JIT jednym prostym poleceniem!
    # Nie musisz już deklarować SatelliteCloudCNN ani robić fuzji i dummy passów!
    model_int8 = torch.jit.load(FILE_INT8)
    model_int8.eval()
    
    # Odpalamy Twoje funkcje (model INT8 musi być testowany na CPU!):
    get_model_size(model_int8, "Skwantyzowany Model (Int8)")
    evaluate_accuracy(model_int8, dataloader, torch.device('cpu'))
    show_confusion_matrix(model_int8, dataloader, torch.device('cpu'), title_suffix="Int8")
else:
    print(f"BŁĄD: Nie widzę pliku {FILE_INT8}. Upewnij się, że nazwa jest poprawna.")