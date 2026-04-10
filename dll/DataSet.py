import os
import torch
from torch.utils.data import Dataset, DataLoader
from PIL import Image
import numpy as np
class Cloud95Dataset(Dataset):
    def __init__(self, base_folder):
        self.red_dir = os.path.join(base_folder, 'train_red')
        self.green_dir = os.path.join(base_folder, 'train_green')
        self.blue_dir = os.path.join(base_folder, 'train_blue')
        self.gt_dir = os.path.join(base_folder, 'train_gt')

        # 1. Pobieramy nazwy i wycinamy przedrostki, żeby mieć "czyste" ID (np. patch_123)
        red_files = {f.replace('red_', '') for f in os.listdir(self.red_dir) if f.lower().endswith('.tif')}
        green_files = {f.replace('green_', '') for f in os.listdir(self.green_dir) if f.lower().endswith('.tif')}
        blue_files = {f.replace('blue_', '') for f in os.listdir(self.blue_dir) if f.lower().endswith('.tif')}
        gt_files = {f.replace('gt_', '') for f in os.listdir(self.gt_dir) if f.lower().endswith('.tif')}

        # 2. Szukamy tylko tych plików, które są we WSZYSTKICH 4 folderach
        self.valid_base_names = list(red_files & green_files & blue_files & gt_files)
        
        print(f"Znaleziono {len(self.valid_base_names)} kompletnych zestawów zdjęć.")

    def __len__(self):
        return len(self.valid_base_names)

    def __getitem__(self, idx):
        base_name = self.valid_base_names[idx]
        
        # Budujemy ścieżki dynamicznie (obsługa .TIF i .tif)
        def get_path(directory, prefix):
            p = os.path.join(directory, prefix + base_name)
            if not os.path.exists(p):
                # Próbujemy zmienić wielkość rozszerzenia jeśli plik nie istnieje
                p = p.replace('.TIF', '.tif') if p.endswith('.TIF') else p.replace('.tif', '.TIF')
            return p

        # Otwieramy pliki korzystając z nowej funkcji
        r = np.array(Image.open(get_path(self.red_dir, 'red_')))
        g = np.array(Image.open(get_path(self.green_dir, 'green_')))
        b = np.array(Image.open(get_path(self.blue_dir, 'blue_')))
        mask = np.array(Image.open(get_path(self.gt_dir, 'gt_')))
        
        # ... reszta Twojego kodu (RGB stack, normalizacja, label) ...
        rgb_image = np.stack([r, g, b], axis=-1)
        image_tensor = torch.tensor(rgb_image, dtype=torch.float32).permute(2, 0, 1) / 255.0
        
        cloud_pixels = np.sum(mask > 0)
        total_pixels = mask.shape[0] * mask.shape[1]
        label = 1 if (cloud_pixels / total_pixels) > 0.05 else 0
        
        return image_tensor, torch.tensor(label, dtype=torch.long)