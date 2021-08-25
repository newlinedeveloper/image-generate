'use strict';
// The Cloud Functions for Firebase SDK to create Cloud Functions and setup triggers.
const functions = require('firebase-functions');
const { Storage } = require('@google-cloud/storage');
const admin = require('firebase-admin');
// admin.initializeApp();
// const path = require('path');
const { join, dirname } = require('path');
const sharp = require('sharp');
// const os = require('os');
const {tmpdir} = require('os');
const fs = require('fs-extra');
const { promisify } = require('util');
const convert = require('heic-convert');
const moment = require('moment');

const THUMB_MAX_WIDTH = 200;
const THUMB_MAX_HEIGHT = 200;


const THUMB_MAX_200 = 200;

const THUMB_MAX_400 = 400;

const THUMB_MAX_1000 = 800;


// const gcs = new Storage();



var serviceAccount = require("./images-service-key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://images-5d13c-default-rtdb.firebaseio.com/"
});

const firestore = admin.firestore();
const db = admin.database();


var config = {
  projectId: 'images-5d13c',
  keyFilename: './images-service-key.json',
  credentials: serviceAccount
};

const gcs = new Storage(config);
// const bucket = storage.bucket('images-5d13c.appspot.com/');



exports.generateThumbnail = functions.runWith({memory: '1GB', timeoutSeconds: '360'})
  .storage
  .object()
  .onFinalize(async object => {
    let bucket = gcs.bucket(object.bucket);
    let filePath = object.name;
    let fileName = filePath.split('/').pop();
    // let bucketDir = dirname(filePath);

    let imageKey = fileName+"_"+new Date().getTime().toString();


    let firebaseData = {};

    firebaseData['events'] = {
      "system_assigned" : {
        "description" : "",
        "timestamp" : new Date().getTime()
      }
    }

    const refImage = db.ref('log');

    let imageType = ['image','application']

    let contentType = object.contentType.split("/")[0]

    console.log("OBbject => "+object.contentType);
    functions.logger.log('Before Image Size => '+ object.size+" Bytes");

    let bucketDir = "thumbnails";

    let workingDir = join(tmpdir(), 'thumbs');
    let tmpFilePath = join(workingDir, 'source.png');

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



   firebaseData['output'] = {}

  //  let file['output'] = {}

    const uploadPromises = sizes.map(async size => {

      let thumbName = `thumb@${size}_${fileName}`;
      let thumbPath = join(workingDir, thumbName);

      let start = new Date().getTime()

    // Sharp docs  https://sharp.pixelplumbing.com/api-resize
      await sharp(tmpFilePath)
        .resize(size, size,{
          fit: sharp.fit.inside,
          withoutEnlargement: true
        })
        .toFile(thumbPath);
      
        bucketDir = "thumbnails"+size.toString();

        var fileSize = fs.statSync(thumbPath);
        functions.logger.log(`After Image Size ${size} * ${size} =>` + fileSize.size+" Bytes");

        let uploadPath = bucketDir+"/"+thumbName;

        const thumbFile = bucket.file(uploadPath);
       
        await bucket.upload(thumbPath, {
          destination: join(bucketDir, thumbName)
        });


      const results = await Promise.all([
        thumbFile.getSignedUrl({
          action: 'read',
          expires: '03-01-2500',
        })
      ]);
      functions.logger.log('Got Signed URLs.');
      let thumbResult = results[0];
      let thumbFileUrl = thumbResult[0];

      console.log(size +' url => '+thumbFileUrl);

        let end = new Date().getTime()


        firebaseData['output'][size] = {
          'start' : start,
          'end' : end,
          'OriginalName' : fileName,
          'format' : fileName.split(".")[1],
          "StandsStart" : moment(start).format('LLLL'),
          'StandsEnd' : moment(end).format('LLLL'),
          'elapsed' : end -start,
          'bytes' : fileSize.size,
          'width' : size,
          'height' : size,
          'urlAccess' : thumbFileUrl,
          'status' : 'success',
          'error' : 'no'
        };

        console.log("finished =>"+size);

      // Upload to GCS
      return size;

    });

    // 4. Run the upload operations
    await Promise.all(uploadPromises);


    
    imageKey = imageKey.replace(/[&\/\\#, +()$~%.'":*?<>{}]/g, '_');

    const imageRef = refImage.child(imageKey);
    await imageRef.set(firebaseData);

    console.log("image uploaded to firebase");

    // 5. Cleanup remove the tmp/thumbs from the filesystem
    return fs.remove(workingDir);
  });