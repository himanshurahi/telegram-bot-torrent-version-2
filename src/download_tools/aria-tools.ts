import downloadUtils = require('./utils');
import drive = require('../fs-walk');
const Aria2 = require('aria2');
import constants = require('../.constants');
import tar = require('../drive/tar');
const diskspace = require('diskspace');
import filenameUtils = require('./filename-utils');
import { DlVars } from '../dl_model/detail';
//added by himanshu rahi
const request = require('request')

const ariaOptions = {
  host: 'localhost',
  port: constants.ARIA_PORT ? constants.ARIA_PORT : 8210,
  secure: false,
  secret: constants.ARIA_SECRET,
  path: '/jsonrpc'
};
const aria2 = new Aria2(ariaOptions);
export function openWebsocket(callback: (err: string) => void): void {
  aria2.open()
    .then(() => {
      callback(null);
    })
    .catch((err: string) => {
      callback(err);
    });
}

export function setOnDownloadStart(callback: (gid: string, retry: number) => void): void {
  aria2.onDownloadStart = (keys: any) => {
    callback(keys.gid, 1);
  };
}

export function setOnDownloadStop(callback: (gid: string, retry: number) => void): void {
  aria2.onDownloadStop = (keys: any) => {
    callback(keys.gid, 1);
  };
}

export function setOnDownloadComplete(callback: (gid: string, retry: number) => void): void {
  aria2.onDownloadComplete = (keys: any) => {
    callback(keys.gid, 1);
  };
}

export function setOnDownloadError(callback: (gid: string, retry: number) => void): void {
  aria2.onDownloadError = (keys: any) => {
    console.log('error occures')
    console.log(keys)
    callback(keys.gid, 1);
  };
}

export function getAriaFilePath(gid: string, callback: (err: string, file: string) => void): void {
  aria2.getFiles(gid, (err: any, files: any[]) => {
    if (err) {
      callback(err.message, null);
    } else {
      var filePath = filenameUtils.findAriaFilePath(files);
      if (filePath) {
        callback(null, filePath.path);
      } else {
        callback(null, null);
      }
    }
  });
}

/**
 * Get a human-readable message about the status of the given download. Uses
 * HTML markup. Filename and filesize is always present if the download exists,
 * message is only present if the download is active.
 * @param {string} gid The Aria2 GID of the download
 * @param {function} callback The function to call on completion. (err, message, filename, filesize).
 */
export function getStatus(dlDetails: DlVars,
  callback: (err: string, message: string, filename: string, filesizeStr: string) => void): void {
  aria2.tellStatus(dlDetails.gid,
    ['status', 'totalLength', 'completedLength', 'downloadSpeed', 'files', 'numSeeders','connections'],
    (err: any, res: any) => {
      if (err) {
        callback(err.message, null, null, null);
      } else if (res.status === 'active') {
        var statusMessage = downloadUtils.generateStatusMessage(parseFloat(res.totalLength),
          parseFloat(res.completedLength), parseFloat(res.downloadSpeed), res.files, false, res.numSeeders, res.connections);
        callback(null, statusMessage.message, statusMessage.filename, statusMessage.filesize);
      } else if (dlDetails.isUploading) {
        var downloadSpeed: number;
        var time = new Date().getTime();
        if (!dlDetails.lastUploadCheckTimestamp) {
          downloadSpeed = 0;
        } else {
          downloadSpeed = (dlDetails.uploadedBytes - dlDetails.uploadedBytesLast)
            / ((time - dlDetails.lastUploadCheckTimestamp) / 1000);
        }
        dlDetails.uploadedBytesLast = dlDetails.uploadedBytes;
        dlDetails.lastUploadCheckTimestamp = time;

        var statusMessage = downloadUtils.generateStatusMessage(parseFloat(res.totalLength),
          dlDetails.uploadedBytes, downloadSpeed, res.files, true, res.numSeeders, res.connections);
        callback(null, statusMessage.message, statusMessage.filename, statusMessage.filesize);
      } else {
        var filePath = filenameUtils.findAriaFilePath(res['files']);
        var filename = filenameUtils.getFileNameFromPath(filePath.path, filePath.inputPath, filePath.downloadUri);
        var message;
        if (res.status === 'waiting') {
          message = `<i>${filename}</i> - Queued`;
        } else {
          message = `<i>${filename}</i> - ${res.status}`;
        }
        callback(null, message, filename, '0B');
      }
    });
}

export function getError(gid: string, callback: (err: string, message: string) => void): void {
  aria2.tellStatus(gid, ['errorMessage'], (err: any, res: any) => {
    if (err) {
      callback(err.message, null);
    } else {
      callback(null, res.errorMessage);
    }
  });
}

export function isDownloadMetadata(gid: string, callback: (err: string, isMetadata: boolean, newGid: string) => void): void {
  aria2.tellStatus(gid, ['followedBy'], (err: any, res: any) => {
    if (err) {
      callback(err.message, null, null);
    } else {
      if (res.followedBy) {
        callback(null, true, res.followedBy[0]);
      } else {
        callback(null, false, null);
      }
    }
  });
}

export function getFileSize(gid: string, callback: (err: string, fileSize: number) => void): void {
  aria2.tellStatus(gid,
    ['totalLength'],
    (err: any, res: any) => {
      if (err) {
        callback(err.message, res);
      } else {
        callback(null, res['totalLength']);
      }
    });
}

interface DriveUploadCompleteCallback {
  (err: string, gid: string, url: string, filePath: string, fileName: string, fileSize: number): void;
}

/**
 * Sets the upload flag, uploads the given path to Google Drive, then calls the callback,
 * cleans up the download directory, and unsets the download and upload flags.
 * If a directory  is given, and isTar is set in vars, archives the directory to a tar
 * before uploading. Archival fails if fileSize is equal to or more than the free space on disk.
 * @param {dlVars.DlVars} dlDetails The dlownload details for the current download
 * @param {string} filePath The path of the file or directory to upload
 * @param {number} fileSize The size of the file
 * @param {function} callback The function to call with the link to the uploaded file
 */
export function uploadFile(dlDetails: DlVars, filePath: string, fileSize: number, callback: DriveUploadCompleteCallback): void {

  dlDetails.isUploading = true;
  var fileName = filenameUtils.getFileNameFromPath(filePath, null);
  var realFilePath = filenameUtils.getActualDownloadPath(filePath);
  if (dlDetails.isTar) {
    if (filePath === realFilePath) {
      // If there is only one file, do not archive
      driveUploadFile(dlDetails, realFilePath, fileName, fileSize, callback);
    } else {
      diskspace.check(constants.ARIA_DOWNLOAD_LOCATION_ROOT, (err: string, res: any) => {
        if (err) {
          console.log('uploadFile: diskspace: ' + err);
          // Could not archive, so upload normally
          driveUploadFile(dlDetails, realFilePath, fileName, fileSize, callback);
          return;
        }
        if (res['free'] > fileSize) {
          console.log('Starting archival');
          var destName = fileName + '.tar';
          tar.archive(realFilePath, destName, (err: string, size: number) => {
            if (err) {
              callback(err, dlDetails.gid, null, null, null, null);
            } else {
              console.log('Archive complete');
              driveUploadFile(dlDetails, realFilePath + '.tar', destName, size, callback);
            }
          });
        } else {
          console.log('uploadFile: Not enough space, uploading without archiving');
          driveUploadFile(dlDetails, realFilePath, fileName, fileSize, callback);
        }
      });
    }
  } else {
    driveUploadFile(dlDetails, realFilePath, fileName, fileSize, callback);
  }
}

function driveUploadFile(dlDetails: DlVars, filePath: string, fileName: string, fileSize: number, callback: DriveUploadCompleteCallback): void {
  drive.uploadRecursive(dlDetails,
    filePath,
    constants.GDRIVE_PARENT_DIR_ID,
    (err: string, url: string) => {
      callback(err, dlDetails.gid, url, filePath, fileName, fileSize);
    });
}

export function stopDownload(gid: string, callback: () => void): void {
  console.log('Download Cancelled :'+gid)
  aria2.remove(gid, callback);
}

export function addUri(username : any,uri: string, dlDir: string, callback: (err: any, gid: any) => void): void {
  let d:any;
  
  aria2.addUri([uri], { dir: `${constants.ARIA_DOWNLOAD_LOCATION}/${dlDir}` })
    .then((gid: string) => {
      
      aria2.tellStatus(gid, ["totalLength", "infoHash" ,"numSeeders" ,"connections" , "files"], (err:any, resp : any) => {
       
        callback(null, {gid:gid, infoHash : resp.infoHash, fileName : resp.files[0].path.substring(10)});
      })

      // callback(null, {gid : gid});
    })
    .catch((err: any) => {
      callback(err, null);
    });
}

// aria2.tellStatus(gid, ["totalLength", "infoHash" ,"numSeeders" ,"connections" , "files"], (err:any, resp : any) => {
      
//   checkHash(resp.infoHash, (err,res) => {
//    //  console.log(res.body)
//    if(!err){
//      d = res.body
//     if(!res.body.found){
    
//      AddToDB(gid, username, resp, (err, res) => {
//        console.log('Added To DB (gid): '+gid)
       
//      })
//       callback(null, gid);
//     }else{
//       let myError = {message : `Torrent Already Downloaded...${d.user}`}
//        callback(myError, gid);
//     }
//    }else{
//      let myError = {message : `${err.code}`}
//       callback(myError, null);
//    }
   

//   })
//  })

//custom function <-- added By Himanshu Rahi

export function AddToDB(gid:any,username:any,infoHash:any, fileName:any, callback : (err:any, res:any) => void){
  console.log(`${constants.API_LINK}/savetorrent`)
  console.log(gid+"Add TO DB")
  request.post({url : `${constants.API_LINK}/savetorrent`, json:true, body : {
        gid : gid,
        name : fileName,
        infoHash : infoHash,
        user : username,
        is_downloaded : false


       }}, (err:any, res:any) => {
        if(err){
          callback(err, null)
        }else{
          callback(null, res)
        }
       })
  
}

export function checkHash(infoHash:any, callback : (err:any, res:any) => void){
 
    request.get({url : `${constants.API_LINK}/checkhash/${infoHash}`, json:true}, (err:any,res:any) => {
          if(res){
            
            callback(null, res)
          }else{
            callback(err, null)
          }
    })
}

export function checkHashAgain(infoHash:any, callback : (err:any, res:any) => void){
 
  request.get({url : `${constants.API_LINK}/checkhashagain/${infoHash}`, json:true}, (err:any,res:any) => {
        if(res){
          
          callback(null, res)
        }else{
          callback(err, null)
        }
  })
}




export function changeGid(gid:any, newGid:any, download:any, callback : (err:any, res:any) => void){
  // `${constants.API_LINK}/savetorrent/${gid}?gid=${newGid}&download=${download}`
  request.patch({url : `${constants.API_LINK}/savetorrent/${gid}?gid=${newGid}&download=${download}`,json:true}, (err:any, res:any) => {
    if(res){
      console.log(res.body)
      callback(null, res)
    }else{
      callback(err, null)
    }
  })
  
}

export function deleteTorrent(gid:any, callback : (err:any, res:any) => void){
  request.delete({url : `${constants.API_LINK}/savetorrent/${gid}`, json:true}, (err:any, res:any) => {
    if(res){
      console.log(res.body)
      callback(null, res)
    }else{
      callback(err, null)
    }
  })
}

export function DBSaveDownloadComplete(gid:any, fileName : any, infoHash:any ,gdlink:any, indexlink:any, fileSize:any, callback : (err:any, res:any) => void){
  request.post({uri : `${constants.API_LINK}/savetorrent/GDLinkdownloadcomplete`, json : true, body : {
    gid : gid,
    fileName : fileName,
    infoHash : infoHash,
    fileSize : fileSize,
    GDLink : gdlink,
    IndexLink : indexlink
  }}, (err:any, res:any) => {
    if(res){
      callback(null, res)
    }else{
      callback(err, null)
    }
  })
}

export  function ADURL(gurl :any, indexurl:any, callback : (err : any, res:any) => void){
  request.get({uri : `http://ouo.io/api/W9dxceA8?s=${gurl}`}, (err:any, res:any) => {
    request.get({uri : `http://ouo.io/api/W9dxceA8?s=${indexurl}`}, (err1:any, res1:any) => {
    if(res){
      callback(null, {adgurl : res.body, adindexurl : res1.body})
    }else{
      callback(err, null)
    }
  })

  })
 
  
}

export  function SingleADURL(url : any, callback : (err:any, res :any) => void){
   request.get({uri : `http://ouo.io/api/W9dxceA8?s=${url}`}, (err:any, res:any) => {
    if(res){
      callback(null, res)
    }else{
      callback(err, null)
    }
  })
}