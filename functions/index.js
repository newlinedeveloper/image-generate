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

const THUMB_MAX_WIDTH = 200;
const THUMB_MAX_HEIGHT = 200;


const THUMB_MAX_200 = 200;

const THUMB_MAX_400 = 400;

const THUMB_MAX_1000 = 1000;


const gcs = new Storage();


exports.generateThumbnail = functions.storage
  .object()
  .onFinalize(async object => {
    const bucket = gcs.bucket(object.bucket);
    const filePath = object.name;
    const fileName = filePath.split('/').pop();
    // let bucketDir = dirname(filePath);

    let bucketDir = "thumbnails";

    const workingDir = join(tmpdir(), 'thumbs');
    const tmpFilePath = join(workingDir, 'source.png');

    if (fileName.includes('thumb@') || !object.contentType.includes('image')) {
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

    if (object.size >= 1000000){
      sizes.push(THUMB_MAX_1000);
    }
    

    const uploadPromises = sizes.map(async size => {

      const thumbName = `thumb@${size}_${fileName}`;
      const thumbPath = join(workingDir, thumbName);

      // Resize source image
      await sharp(tmpFilePath)
        .resize(size, size)
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