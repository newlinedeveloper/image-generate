'use strict';
// The Cloud Functions for Firebase SDK to create Cloud Functions and setup triggers.
const functions = require('firebase-functions');
const { Storage } = require('@google-cloud/storage');
const admin = require('firebase-admin');
admin.initializeApp();
// const path = require('path');
const { join, dirname } = require('path');
const sharp = require('sharp');
// const os = require('os');
const {tmpdir} = require('os');
const fs = require('fs-extra');
const { promisify } = require('util');
const convert = require('heic-convert');

const THUMB_MAX_WIDTH = 200;
const THUMB_MAX_HEIGHT = 200;


const THUMB_MAX_200 = 200;

const THUMB_MAX_400 = 400;

const THUMB_MAX_1000 = 800;


const gcs = new Storage();


exports.generateThumbnail = functions.runWith({memory: '1GB', timeoutSeconds: '360'})
  .storage
  .object()
  .onFinalize(async object => {
    let bucket = gcs.bucket(object.bucket);
    let filePath = object.name;
    let fileName = filePath.split('/').pop();
    // let bucketDir = dirname(filePath);

    let imageType = ['image','application']

    let contentType = object.contentType.split("/")[0]

    console.log("OBbject => "+object.contentType);

    let bucketDir = "thumbnails";

    let workingDir = join(tmpdir(), 'thumbs');
    let tmpFilePath = join(workingDir, 'source.png');

    // if (fileName.includes('thumb@') || !object.contentType.includes('image') || !object.contentType.includes('application/octet-stream')) {
    if (fileName.includes('thumb@') || imageType.indexOf(contentType) == -1) {
      console.log('exiting function');
      return false;
    }

    
    // 1. Ensure thumbnail dir exists
    await fs.ensureDir(workingDir);

    // 2. Download Source File
    await bucket.file(filePath).download({
      destination: tmpFilePath
    });

    // 3. Resize the images and define an array of upload promises

    let sizes = [THUMB_MAX_200, THUMB_MAX_400];

    if (object.size >= 500000){
      sizes.push(THUMB_MAX_1000);
    }

    if(object.contentType.includes('octet-stream') || object.contentType.includes('heic')){

     
      const inputBuffer = await promisify(fs.readFile)(tmpFilePath);
      const outputBuffer = await convert({
        buffer: inputBuffer, // the HEIC file buffer
        format: 'JPEG',      // output format
        quality: 1           // the jpeg compression quality, between 0 and 1
      });
      fileName=fileName.replace('heic','jpeg');

    
      await promisify(fs.writeFile)(tmpFilePath, outputBuffer);

      
      
    }
   

    const uploadPromises = sizes.map(async size => {

      let thumbName = `thumb@${size}_${fileName}`;
      let thumbPath = join(workingDir, thumbName);

    // Sharp docs  https://sharp.pixelplumbing.com/api-resize
      await sharp(tmpFilePath)
        .resize(size, size,{
          fit: sharp.fit.inside,
          withoutEnlargement: true
        })
        .toFile(thumbPath);
      
        bucketDir = "thumbnails"+size.toString();

      // Upload to GCS
      return bucket.upload(thumbPath, {
        destination: join(bucketDir, thumbName)
      });
    });

    // 4. Run the upload operations
    await Promise.all(uploadPromises);

    // 5. Cleanup remove the tmp/thumbs from the filesystem
    return fs.remove(workingDir);
  });