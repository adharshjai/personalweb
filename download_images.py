import urllib.request
import json
import os

def download_wiki_image(page_title, filename):
    url = f"https://en.wikipedia.org/w/api.php?action=query&titles={page_title}&prop=pageimages&format=json&pithumbsize=1000"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode())
            pages = data['query']['pages']
            page_id = list(pages.keys())[0]
            if 'thumbnail' in pages[page_id]:
                img_url = pages[page_id]['thumbnail']['source']
                urllib.request.urlretrieve(img_url, filename)
                print(f"Downloaded {filename}")
            else:
                print(f"No image found for {page_title}")
    except Exception as e:
        print(f"Error downloading {page_title}: {e}")

os.makedirs('public', exist_ok=True)
download_wiki_image('Mantis_shrimp', 'public/mantis_shrimp.jpg')
download_wiki_image('Kayser–Fleischer_ring', 'public/kf_ring.jpg')
download_wiki_image('Glaucoma', 'public/glaucoma.jpg')
download_wiki_image('Slit_lamp', 'public/eyenova_device.jpg')
