import {forwardRef,type AnchorHTMLAttributes,type MouseEvent} from 'react';
// Keep native link behavior except between dashboard sections, where a reload briefly blanks the workspace.
const Link=forwardRef<HTMLAnchorElement,AnchorHTMLAttributes<HTMLAnchorElement>>(function Link({onClick,...props},ref){
  function handleClick(event:MouseEvent<HTMLAnchorElement>){
    onClick?.(event);
    if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||props.download||props.target&&props.target!=='_self')return;
    const destination=new URL(event.currentTarget.href);
    if(destination.origin!==window.location.origin||destination.hash||!/^\/dashboard(?:\/|$)/.test(window.location.pathname)||!/^\/dashboard(?:\/|$)/.test(destination.pathname))return;
    event.preventDefault();
    if(destination.pathname+destination.search!==window.location.pathname+window.location.search){
      window.history.pushState(null,'',destination.pathname+destination.search);
      window.dispatchEvent(new PopStateEvent('popstate'));
      window.scrollTo({top:0,behavior:'instant'});
    }
  }
  return <a {...props} onClick={handleClick} ref={ref}/>;
});
export default Link;
