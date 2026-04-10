import torch
import torch.nn as nn

class SatelliteCloudCNN(nn.Module):
    def __init__(self):
        super().__init__()
        
        # --- ELEMENTY DO KWANTYZACJI ---
        # QuantStub zamienia float32 na int8 na wejściu
        self.quant = torch.ao.quantization.QuantStub()
        # DeQuantStub zamienia int8 z powrotem na float32 na wyjściu
        self.dequant = torch.ao.quantization.DeQuantStub()
        
        # 1. WARSTWA: Wykrywanie krawędzi (RGB -> 16 map)
        self.conv1 = nn.Conv2d(in_channels=3, out_channels=16, kernel_size=3, padding=1)
        self.relu1 = nn.ReLU() # Zdefiniowane jako atrybut dla fuzji!
        
        # Narzędzie do zmniejszania obrazu
        self.pool = nn.MaxPool2d(kernel_size=2, stride=2)
        
        # 2. WARSTWA: Wykrywanie tekstur chmur (16 -> 32 mapy)
        self.conv2 = nn.Conv2d(in_channels=16, out_channels=32, kernel_size=3, padding=1)
        self.relu2 = nn.ReLU() # Zdefiniowane jako atrybut dla fuzji!
        
        # 3. MAGIC RESIZER: Sprowadza każdą mapę do rozmiaru 1x1
        self.magic_resizer = nn.AdaptiveAvgPool2d((1, 1))
        
        # 4. DETEKTYW (Klasyfikator): 32 cechy -> 2 klasy (Czysto/Chmury)
        self.detective = nn.Linear(in_features=32, out_features=2) 

    def forward(self, x):
        # Start kwantyzacji
        x = self.quant(x)
        
        # Warstwa 1
        x = self.conv1(x)
        x = self.relu1(x)
        x = self.pool(x)
        
        # Warstwa 2
        x = self.conv2(x)
        x = self.relu2(x)
        x = self.pool(x)
        
        # Spłaszczenie do 32 cech
        x = self.magic_resizer(x)
        x = x.view(-1, 32)
        
        # Decyzja detektywa
        x = self.detective(x)
        
        # Koniec kwantyzacji
        x = self.dequant(x)
        
        return x