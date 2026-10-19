export async function browserLogo(file: File) {
  const image = await createImageBitmap(file);
  try {
    if (image.width*image.height>16000000) throw new Error('Logo must be under 16 million pixels.');
    const scale=Math.min(1,256/image.width,256/image.height),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
    canvas.getContext('2d')!.drawImage(image,0,0,canvas.width,canvas.height);
    return canvas.toDataURL('image/png');
  } finally { image.close(); }
}
