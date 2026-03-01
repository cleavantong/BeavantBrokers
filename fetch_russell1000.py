import requests
from bs4 import BeautifulSoup

def get_russell1000_tickers():
    url = "https://en.wikipedia.org/wiki/Russell_1000_Index"
    res = requests.get(url)
    res.raise_for_status()
    soup = BeautifulSoup(res.text, "html.parser")

    # find the heading containing "Components" (case-insensitive)
    for header in soup.find_all(["h2","h3"]):
        if "components" in header.text.lower():
            # collect the first table after this header
            table = header.find_next("table", {"class": "wikitable"})
            if not table:
                continue
            tickers = []
            rows = table.find_all("tr")[1:]
            for row in rows:
                cols = row.find_all("td")
                if len(cols) >= 2:
                    # Column 2 is the Symbol
                    symbol = cols[1].text.strip().upper()
                    if symbol.isalnum():
                        tickers.append(symbol)
            if tickers:
                return tickers

    raise RuntimeError("❌ Could not find the Russell 1000 components table.")

if __name__ == "__main__":
    tickers = get_russell1000_tickers()
    print(f"✅ Found {len(tickers)} tickers")
    formatted = "[" + ",".join(f'"{t}"' for t in tickers) + "]"
    with open("russell1000_tickers.py", "w") as f:
        f.write("tickers = " + formatted)
    print("✅ Tickers saved to russell1000_tickers.py")
