import {forwardRef,type ImgHTMLAttributes} from 'react';
type Props=Omit<ImgHTMLAttributes<HTMLImageElement>,'src'>&{src:string;priority?:boolean;unoptimized?:boolean;quality?:number;fill?:boolean};
const Image=forwardRef<HTMLImageElement,Props>(function Image({priority,unoptimized,quality,fill,style,...props},ref){return <img {...props} ref={ref} loading={priority?'eager':props.loading??'lazy'} style={fill?{position:'absolute',inset:0,width:'100%',height:'100%',...style}:style}/>});
export default Image;
