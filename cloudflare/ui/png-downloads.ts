// Native image libraries cannot run in Workers. Rasterize authenticated SVG
// exports locally in the staff browser; QR destinations are never fetched here.
document.addEventListener('click', async event => {
  const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href]');
  if (!anchor) return;
  const url = new URL(anchor.href);
  if (url.origin !== location.origin || !/^\/api\/manage\/codes\/[0-9a-f-]+\/download$/.test(url.pathname) || url.searchParams.get('format') !== 'png') return;
  event.preventDefault();
  try {
    url.searchParams.set('format','svg');
    const response = await fetch(url,{cache:'no-store'});
    if (!response.ok) throw new Error((await response.json()).error || 'Unable to download QR.');
    const source = URL.createObjectURL(await response.blob());
    try {
      const image = new Image(); image.src = source; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
      if (!canvas.width || canvas.width>2048 || canvas.height>2048) throw new Error('Invalid export dimensions.');
      canvas.getContext('2d')!.drawImage(image,0,0);
      const blob = await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('PNG conversion failed.')),'image/png'));
      const download = URL.createObjectURL(blob), link=document.createElement('a');link.href=download;link.download=`capreqr-${url.pathname.split('/')[4]}.png`;link.click();setTimeout(()=>URL.revokeObjectURL(download),30000);
    } finally { URL.revokeObjectURL(source); }
  } catch (error) { window.alert((error as Error).message); }
});
