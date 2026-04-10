import os

import torch

# ==========================================
# FUNKCJA 1: Obliczanie rozmiaru modelu w MB
# ==========================================
def get_model_size(model, model_name="Model"):
    """
    Najlepszym sposobem na sprawdzenie wagi modelu jest zapisanie go 
    do tymczasowego pliku i sprawdzenie, ile miejsca zajmuje na dysku.
    """
    temp_file = "temp_model_size.pth"
    torch.save(model.state_dict(), temp_file)
    size_mb = os.path.getsize(temp_file) / (1024 * 1024) # Konwersja bajtów na MB
    os.remove(temp_file) # Sprzątamy po sobie
    
    print(f"📦 Rozmiar modelu '{model_name}': {size_mb:.2f} MB")
    return size_mb

# ==========================================
# FUNKCJA 2: Ostateczne obliczanie Accuracy
# ==========================================
def evaluate_accuracy(model, dataloader, device):
    """
    Przechodzi przez cały zbiór danych i liczy procent poprawnych odpowiedzi.
    """
    model.eval()
    correct = 0
    total = 0
    
    with torch.no_grad():
        for images, labels in dataloader:
            images, labels = images.to(device), labels.to(device)
            outputs = model(images)
            
            # Bierzemy indeks klasy z najwyższym prawdopodobieństwem
            _, predicted = torch.max(outputs.data, 1)
            
            total += labels.size(0)
            correct += (predicted == labels).sum().item()
            
    accuracy = correct / total
    print(f"🎯 Dokładność (Accuracy) modelu: {accuracy:.2%}")
    return accuracy