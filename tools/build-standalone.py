"""Builds ORBIT.html: the stand-alone demo (engine + chart + interface inlined, no server)."""
import os
root=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rd=lambda n:open(os.path.join(root,'orbit',n),encoding='utf8').read()
html=rd('index.html')
html=html.replace('<link rel="stylesheet" href="style.css">','<style>'+rd('style.css')+'</style>')
for name in ('engine','chart','app'):
    html=html.replace(f'<script src="{name}.js"></script>','<script>'+rd(name+'.js')+'</script>')
html=html.replace('<script src="live.js"></script>','')
assert 'src=' not in html.replace('<meta','')
open(os.path.join(root,'ORBIT.html'),'w',encoding='utf8',newline='\n').write(html)
print('ORBIT.html:',len(html),'bytes')
