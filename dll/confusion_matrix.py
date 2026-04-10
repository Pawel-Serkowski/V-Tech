import torch
from sklearn.metrics import confusion_matrix
import seaborn as sns
import matplotlib.pyplot as plt

def show_confusion_matrix(trained_model, dataloader, device):
    print("\nGenerowanie Confusion Matrix...")
    trained_model.eval() # Przełączamy na tryb testowy
    
    all_preds = []
    all_labels = []
    
    # Wyłączamy liczenie gradientów, bo tylko testujemy
    with torch.no_grad():
        for images, labels in dataloader:
            images = images.to(device)
            outputs = trained_model(images)
            
            # Wybieramy klasę z najwyższym prawdopodobieństwem
            _, preds = torch.max(outputs, 1)
            
            # Zbieramy wszystko do list (przenosząc z powrotem na CPU)
            all_preds.extend(preds.cpu().numpy())
            all_labels.extend(labels.numpy())
            
    # Obliczanie macierzy za pomocą scikit-learn
    cm = confusion_matrix(all_labels, all_preds)
    
    # Rysowanie pięknego wykresu cieplnego (Heatmap)
    plt.figure(figsize=(8, 6))
    sns.heatmap(cm, annot=True, fmt='d', cmap='Blues', 
                xticklabels=['Czysto (0)', 'Chmury (1)'], 
                yticklabels=['Czysto (0)', 'Chmury (1)'])
    
    plt.ylabel('Prawdziwa odpowiedź (Ground Truth)')
    plt.xlabel('To, co strzelił model (Prediction)')
    plt.title('Macierz Pomyłek - Detekcja Chmur')
    plt.show()

# --- JAK TEGO UŻYĆ W TWOIM KODZIE ---
# Wywołaj to na samym końcu, podając swój model, dataloader i urządzenie
# show_confusion_matrix(model_int8, dataloader, device) # Dla skwantowanego
# show_confusion_matrix(model, dataloader, device)      # Dla zwykłego