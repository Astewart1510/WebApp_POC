const mongodb = require('mongodb');
const User = require('./schemas.js').User;
const FileRights = require('./schemas.js').FileRights;
const MongoClient = mongodb.MongoClient;

let db;

MongoClient.connect('mongodb://localhost', { useNewUrlParser: true, useUnifiedTopology: true }, (err, database) => {
  if (err) {
    console.log('MongoDB Connection Error. Please make sure that MongoDB is running.');
    process.exit(1);
  }
  db = database.db('thesisPOC');
});


async function get_file_buffer(file_id) {
   let bucket = new mongodb.GridFSBucket(db, {
      bucketName: 'UserFiles'
    });
    
    var photoID = new mongodb.ObjectID(file_id);
    let buffer = [];
    let downloadStream = await bucket.openDownloadStream(photoID); 
    //console.log(downloadStream);
    await downloadStream.on('data', (chunk) => {
      buffer.push(chunk)
    });
    await downloadStream.on("end", function () {
    let full_buffer = Buffer.concat(buffer);
    console.log(full_buffer);
    return full_buffer
    })
}

async function get_owner_files_ids(owner_id) {
  let files = await FileRights.find({ owner: owner_id}, { file_id: 1, _id: 0 });
  let files_ = JSON.parse(JSON.stringify(files));
  file_ids = [];
  for (i in files_) {
    file_ids[i] = (files_[i]["file_id"])
  }
  return file_ids
}

async function get_owner_files(owner_id) {
  let files = await FileRights.find({ owner: owner_id}, { _id: 0 });
  let files_ = JSON.parse(JSON.stringify(files));
//   file_ids = [];
//   for (i in files_) {
//     file_ids[i] = (files_[i]["file_id"])
//   }
  return files_
}

// async function get_viewing_files(uer_id) {
// let files = await FileRights.find({ owner: user_id}, { file_id: 1, _id: 0 });
//   let files_ = JSON.parse(JSON.stringify(files));
//   file_ids = [];
//   for (i in files_) {
//     file_ids[i] = (files_[i]["file_id"])
//   }
//   return file_ids
// }

async function get_user(user_id) {
  let user = await User.find({ _id: user_id }, { _id: 0 }); //username: 1, firstName: 1, LastName: 1, mobile: 1, salt: 0, hash: 0,
  let userData = JSON.parse(JSON.stringify(user))
  return userData
  
}

async function get_file(file_id) {
  let file = await FileRights.find({ file_id: file_id}, { _id: 0 });
  let file_ = JSON.parse(JSON.stringify(file));
//   file_ids = [];
//   for (i in files_) {
//     file_ids[i] = (files_[i]["file_id"])
//   }
  return file_
}

async function get_owner_one_file(owner_id, file_id) {
  let file_owner = await FileRights.find({owner: owner_id, file_id: file_id}, { _id: 0, viewers: 0, file_id: 0, name: 0, type: 0 });
  let file_owner_id = JSON.parse(JSON.stringify(file_owner));
  return file_owner_id[0].owner
}

async function get_all_usernames() {
  let usernames = await User.find({ group: 'user' }, { _id: 0, username: 1 });
  usernames_ = [];
  for (i in usernames) {
    usernames_[i] = usernames[i]["username"]
  }
  return usernames_
}




module.exports = {
    get_file_buffer,
    get_owner_files_ids,
    get_owner_files,
    get_user,
  get_file,
  get_owner_one_file,
    get_all_usernames
}