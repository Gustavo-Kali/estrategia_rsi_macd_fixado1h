import pandas as pd
import json

import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
parquet_path = os.path.join(BASE_DIR, "btc_30m_3years.parquet")
output_path = os.path.join(BASE_DIR, "btc_30m_3years.json")

print("Lendo arquivo parquet...")
df = pd.read_parquet(parquet_path)

# Converter datetime para timestamp Unix em segundos
# datetime64[ms].astype(int64) retorna milissegundos desde epoch → dividir por 1000 = segundos unix
df['ts'] = (df['datetime'].astype('int64') // 1_000).astype(int)

# Montar lista compacta: [timestamp, open, high, low, close, volume]
candles = []
for _, row in df.iterrows():
    candles.append([
        int(row['ts']),
        round(float(row['open']), 2),
        round(float(row['high']), 2),
        round(float(row['low']), 2),
        round(float(row['close']), 2),
        round(float(row['volume']), 3)
    ])

with open(output_path, 'w') as f:
    json.dump(candles, f, separators=(',', ':'))

print(f"Arquivo gerado com sucesso!")
print(f"Total de candles: {len(candles)}")
print(f"Primeiro candle: {candles[0]}")
print(f"Último candle:  {candles[-1]}")

import os
size_mb = os.path.getsize(output_path) / (1024 * 1024)
print(f"Tamanho do arquivo: {size_mb:.2f} MB")
