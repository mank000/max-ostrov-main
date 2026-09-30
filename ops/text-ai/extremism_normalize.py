"""Additional bounded view for the context classifier; never changes stored text."""
import re,unicodedata
_MAP=str.maketrans({'a':'а','b':'б','c':'с','e':'е','g':'г','h':'х','i':'и','j':'й','k':'к','l':'л','m':'м','n':'н','o':'о','p':'р','r':'р','s':'с','t':'т','u':'у','v':'в','x':'х','y':'у','z':'з','0':'о','1':'и','3':'з','4':'ч','5':'с','6':'б','8':'в','@':'а','$':'с','і':'и','ї':'и','ı':'и'})
_WORD=re.compile(r'[\w@$]+',re.UNICODE)
def normalize_extremism(text):
 text=unicodedata.normalize('NFKC',text).casefold();text=''.join(c for c in text if unicodedata.category(c) not in ('Cf','Cc') or c in '\n\t')
 text=re.sub(r'(?<=\w)!(?=\w)','и',text)
 text=_WORD.sub(lambda m:m[0].translate(_MAP) if any(c.isalpha() for c in m[0]) else m[0],text)
 text=re.sub(r'(?<!\w)[гх]итл[ез]р(?=\b|[а-я])','гитлер',text)
 for word in ['гитлер','хитлер','нацизм','нацист','терроризм','экстремизм']:
  pat=r'(?<!\w)'+r'[\s._*\-]*'.join(word)+r'(?!\w)';text=re.sub(pat,'гитлер' if word=='хитлер' else word,text)
 return text
