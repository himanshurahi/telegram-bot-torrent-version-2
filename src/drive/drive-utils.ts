import ariaTools = require('../download_tools/aria-tools.js');
import request = require('request');

export function getFileLink(fileId: string, isFolder: boolean): string {
  if (isFolder) {
    return 'https://drive.google.com/drive/folders/' + fileId;
  } else {
    return 'https://drive.google.com/uc?id=' + fileId + '&export=download';
  }
}

//   export function getAdLink(fileId: string, isFolder: boolean): Promise<any> {
//   var tmp = ''
//   if (isFolder) {
//     tmp =  'https://drive.google.com/drive/folders/' + fileId;
//   } else {
//     tmp =  'https://drive.google.com/uc?id=' + fileId + '&export=download';
//   }

//   // await ariaTools.SingleADURL(tmp, (err:any, res:any) => {
//   //   return  tmp
//   // })
//   request.get({uri : `http://ouo.io/api/W9dxceA8?s=${tmp}`}, (err:any, res:any) => {
//     if(res){
//       console.log(res.body)
//       return res
//     }else{
//     return err
//     }
//   })
  
  
// }

export function getPublicUrlRequestHeaders(size: number, mimeType: string, token: string, fileName: string, parent: string): any {
  return {
    method: 'POST',
    url: 'https://www.googleapis.com/upload/drive/v3/files',
    qs: { uploadType: 'resumable' },
    headers:
    {
      'Postman-Token': '1d58fdd0-0408-45fa-a45d-fc703bff724a',
      'Cache-Control': 'no-cache',
      'X-Upload-Content-Length': size,
      'X-Upload-Content-Type': mimeType,
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: {
      name: fileName,
      mimeType: mimeType,
      parents: [parent]
    },
    json: true
  };
}