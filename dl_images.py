from duckduckgo_search import DDGS
import urllib.request
import os
import time

os.makedirs('public', exist_ok=True)
queries = {
    'kf_ring.jpg': 'kayser fleischer ring eye high resolution',
    'glaucoma.jpg': 'glaucoma eye medical',
    'eyenova_device.jpg': 'slit lamp device ophthalmology'
}

with DDGS() as ddgs:
    for filename, query in queries.items():
        try:
            time.sleep(2)
            results = list(ddgs.images(query, max_results=1))
            if results:
                url = results[0]['image']
                urllib.request.urlretrieve(url, f'public/{filename}')
                print(f'Downloaded {filename}')
        except Exception as e:
            print(f'Failed {filename}: {e}')
