let courseReadVersion=0;
function clipboardImage(event){
 const files=Array.from(event.clipboardData?.files||[]);
 for(const item of Array.from(event.clipboardData?.items||[]))if(item.kind==='file'){const file=item.getAsFile();if(file)files.push(file)}
 return files.find(file=>file.type.startsWith('image/'));
}
document.addEventListener('paste',event=>{
 if(!document.querySelector('#modal-root .image-drop'))return;
 const file=clipboardImage(event);if(!file)return;
 event.preventDefault();readCourseImage({files:[file],value:''});
});
readCourseImage=function(input){
 const file=input.files[0];if(!file)return;
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)){showStudyAlert('请上传或粘贴 JPG、PNG 或 WebP 图片');return}
 if(file.size>10*1024*1024){showStudyAlert('图片需小于10 MB');return}
 const version=++courseReadVersion,reader=new FileReader();
 reader.onload=()=>{
  if(version!==courseReadVersion)return;
  courseImage={name:file.name||'粘贴的课表截图.png',url:reader.result};
  const preview=document.getElementById('course-image-preview');if(preview)preview.innerHTML=courseImagePreview();
  const button=document.getElementById('course-recognize');if(button)button.disabled=false;
 };
 reader.onerror=()=>{if(version===courseReadVersion)showStudyAlert('图片读取失败，请重新上传或粘贴')};reader.readAsDataURL(file);
};
const openImageImportWithoutPaste=openImageImport;
openImageImport=function(){openImageImportWithoutPaste();const drop=document.querySelector('#modal-root .image-drop');if(drop){drop.tabIndex=0;drop.setAttribute('aria-label','上传课程表图片，也可按Ctrl加V粘贴截图')}};
const useSvgExample=useDemoCourseImage;
useDemoCourseImage=function(){
 useSvgExample();const sample=courseImage,image=new Image();
 const button=document.getElementById('course-recognize');if(button)button.disabled=true;
 image.onload=()=>{
  if(courseImage!==sample)return;
  const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;canvas.getContext('2d').drawImage(image,0,0);
  courseImage={name:'示例课表.png',url:canvas.toDataURL('image/png')};if(document.querySelector('#modal-root .image-drop'))openImageImport();
 };
 image.onerror=()=>showStudyAlert('示例图片读取失败，请上传或粘贴自己的课表');image.src=sample.url;
};
