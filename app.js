//jshint esversion:6
require('dotenv').config();
const express = require("express");
const bodyParser = require("body-parser");
const ejs = require("ejs");
const mongoose = require("mongoose");
const session = require('express-session');
const passport = require("passport");
const LocalStrategy = require('passport-local').Strategy;
const passportLocalMongoose = require("passport-local-mongoose");
const GoogleStrategy = require('passport-google-oauth20').Strategy;
var crypto = require('crypto');
const axios = require('axios');
const fileUpload = require("express-fileupload");
const CryptoJS = require('crypto-js');
const byteSize = require('byte-size');
const bcrypt = require("bcrypt");
const saltRounds = process.env.SALT_ROUNDS;
const fs = require('fs');

// import helper files and schemas
const User = require('./schemas.js').User;
const FileRights = require('./schemas.js').FileRights;
// const Doctor = require('./schemas.js').Doctor;
const myencrypt = require("./encryption_helper.js");
const enclave = require("./routes_enclave.js");
const myquery = require("./db_queries.js")

// Gridfs setup - https://stackoverflow.com/questions/8135718/how-to-use-gridfs-to-store-images-using-node-js-and-mongoose
const multer = require('multer');
var storage = multer.memoryStorage()
var upload = multer({ storage: storage, limits: {fileSize: 200 * 1024 * 1024} });
const mongodb = require('mongodb');
const MongoClient = mongodb.MongoClient;

// initiliase app and passpoort
const app = express();

// so that non-logged in users sessions are not stored i.e. cant go back after logout
app.use(function(req, res, next) {
    if (!req.user)
        res.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    next();
});

app.use(express.static("public"));
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({
  extended: true
}));

app.use(session({
  secret: "Our little secret.",
  resave: false,
  saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

app.use('/jquery', express.static(__dirname + '/node_modules/jquery/dist/'));


//connect to mongodb free cluster
const connection = mongoose.connect("mongodb+srv://test-user:Test123@cluster0.sj7dd.mongodb.net/thesisPOC?retryWrites=true&w=majority", {useNewUrlParser: true, useUnifiedTopology: true, useCreateIndex: true,
        useFindAndModify: false }).then(() => {
        console.log('Database connected successfully!');
      })
      .catch((err) => {
        console.log('Error connecting with error code:', err);
      });

mongoose.set("useCreateIndex", true);
// set up passport on the User schema
passport.use(User.createStrategy());

passport.serializeUser(function(user, done) {
  done(null, user.id);
});

passport.deserializeUser(function(id, done) {
  User.findById(id, function(err, user) {
    done(err, user);
  });
});


// setup for streaming gridfs 
let db;
const { Readable } = require('stream');
const { stringify } = require('querystring');
const { createSecureServer } = require('http2');

MongoClient.connect('mongodb+srv://test-user:Test123@cluster0.sj7dd.mongodb.net/thesisPOC?retryWrites=true&w=majority', { useNewUrlParser: true, useUnifiedTopology: true }, (err, database) => {
  if (err) {
    console.log('MongoDB Connection Error. Please make sure that MongoDB is running.');
    process.exit(1);
  }
  db = database.db('thesisPOC');
});

//Get Routes
app.get("/", function (req, res) {
  if (req.isAuthenticated()) {
    res.render("home_logged_in");
  } else {
  res.render("home");
  }
});

app.get("/login", function (req, res) {
  message = [];
  res.render("login", {message: message});
});

app.get("/login_doctor", function (req, res) {
  message = [];
  res.render("login_doctor", {message: message});
});

app.get("/logout", function(req, res){
  req.logout();
  res.redirect("/");
});

app.get("/register", function(req, res){
  res.render("register");
});

app.get("/register_doctor", function(req, res){
  res.render("register_doctor");
});

app.get("/secrets", async (req, res) => {
  if (req.isAuthenticated()) {
    console.log("this is the true group: ", req.user.group)
    let user = await myquery.get_user(req.user.id)
    let user_data = await decrypt_unseal_PII(user[0].user_data);
    let files = await myquery.get_owner_files(req.user.id);

    if (req.user.group == "doctor") {
      console.log("this oak is a doctor");
        const user_info = ({
       username: user[0].username,
       firstName: user_data.firstName,
       lastName: user_data.lastName,
       mobile: user_data.mobile,
       hospital: user_data.hospital,
       group: user[0].group
      })

      console.log("userinfo", user_info);

      res.render("secrets_doctor", { userInfo: user_info, fileNo: files.length });
    } else if (req.user.group == "user") {
      console.log("this oak is a user");
      const user_info = ({
      username: user[0].username,
      firstName: user_data.firstName,
      lastName: user_data.lastName,
      mobile: user_data.mobile,
      group: user[0].group
      })

      console.log("userinfo", user_info);
      res.render("secrets", { userInfo: user_info, fileNo: files.length });
      }
    
  } else {
    res.redirect("/login");
  }
});

app.get("/view", async (req, res) =>{
  if (req.isAuthenticated()) {
    console.log(req.user);
   
    let files = await myquery.get_owner_files(req.user.id);
    console.log(files);
    user_id = mongodb.ObjectId(req.user.id);
    let files_to_view = await myquery.get_viewing_files(user_id)
    console.log(files_to_view);
   
    var message_deleted= [] ;
    var message_upload = [];
    var message;
    if (req.query.delete == 1) {
      message_deleted = 1;
      message = "File successfully deleted!";
    } else if (req.query.upload == 1) {
      message_upload = 1;
      message = "File successfully uploaded!"
    }
    res.render("view",{ userData: files , message_deleted: message_deleted, message_upload: message_upload, files_to_view: files_to_view, message: message});
  } else {
    res.redirect("/login");
  }
});

app.get("/submit", function(req, res){
  if (req.isAuthenticated()) {
    console.log(req.user);
    res.render("submit");
  } else {
    res.redirect("/login");
  }
});

app.get("/users/view/", async (req, res) => {
  if (req.isAuthenticated()) {
 
    let bucket = new mongodb.GridFSBucket(db, {
      bucketName: 'UserFiles' 
    });  
    let downloadStream = bucket.openDownloadStream(mongodb.ObjectID(req.query.file));
    const chunks = [];

    for await (let chunk of downloadStream) {
        chunks.push(Buffer.from(chunk));
      }

    let buffer_2 = await decrypt_unseal_file(chunks, process.env.SERVER_SECRET)
    console.log("this is the final image buffer", buffer_2);
      
    res.contentType(req.query.type);
    res.set("Content-Disposition", "inline");
    res.send(buffer_2);
  } else {
    res.redirect("/login");
  }
});


////////////// post routes

// register routes
app.post("/register", async (req, res) => {
 
  const saltRounds = 14;
  const hashed_password = await bcrypt.hash(req.body.passcode, saltRounds);
  
  const user_info = ({
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      mobile: req.body.mobile
    });
  
  user_info_sealed_encrypted_string = await encrypt_seal_PII(user_info);

  User.register({username: req.body.username, user_data: user_info_sealed_encrypted_string, passcode: hashed_password }, req.body.password, function(err, user){
    if (err) {
      console.log(err);
      res.send(err);
    } else {
      passport.authenticate("local")(req, res, function(){
        res.redirect("/secrets");
      });
    }
  });
});


app.post("/register_doctor", async (req, res) =>  {
  const saltRounds = 14;
  const hashed_password = await bcrypt.hash(req.body.passcode, saltRounds);
  
   const doctor_info = ({
    firstName: req.body.firstName,
    lastName: req.body.lastName,
     mobile: req.body.mobile,
    hospital: req.body.hospital
  })

  doctor_info_sealed_encrypted_string = await encrypt_seal_PII(doctor_info);

  User.register({username: req.body.username, user_data: doctor_info_sealed_encrypted_string, group: "doctor" , passcode: hashed_password}, req.body.password, function(err, user){
    if (err) {
      console.log(err);
      res.send(err);
    } else {
      passport.authenticate("local")(req, res, function () {
        console.log("successful registtration of doctor");
        res.redirect("/secrets");
      });
    }
  });

});

// login routes
app.post("/login", function(req, res, next){

  const user = new User({
    username: req.body.username,
    password: req.body.password
  });

  req.login(user, function(err){
    if (err) {
      console.log(err);
      message = "Your password or username is incorrect";
      res.render("login", { message: message });
    } else {
      // passport.authenticate("local", {})(req, res, function(){
      //   res.redirect("/secrets");
      //});
       passport.authenticate('local', function(err, user, info) {
    if (err) { return next(err); }
         if (!user) {
           message = "Your password or username is incorrect";
           return res.render('login',{ message: message });
         }
    req.logIn(user, function(err) {
      if (err) {
        return next(err);
      }
      return res.redirect('/secrets');
    });
  })(req, res, next);
    }
  });

});

app.post("/login_doctor", function(req, res){

  const Doctor = new User({
    username: req.body.username,
    password: req.body.password
  });

  req.login(Doctor, function(err){
    if (err) {
      console.log(err);
      message = "Your password or username is incorrect";
      res.render("login", { message: message });
    } else {
      passport.authenticate('local', function(err, user, info) {
    if (err) { return next(err); }
         if (!user) {
           message = "Your password or username is incorrect";
           return res.render('login',{ message: message });
         }
    req.logIn(user, function(err) {
      if (err) {
        return next(err);
      }
      return res.redirect('/secrets');
    });
  })(req, res, next);
    }
  });

});

// user profile routes 

app.post("/user/update", async (req, res) => {
  if (req.isAuthenticated()) {
    var user_info;
    if (req.user.group == "doctor") {
       user_info = ({
        firstName: req.body.firstName,
        lastName: req.body.lastName,
        mobile: req.body.mobile,
        hospital: req.body.hospital
      });

    } else if (req.user.group == "user") {
      var user_info = ({
        firstName: req.body.firstName,
        lastName: req.body.lastName,
        mobile: req.body.mobile
      });

    }
  user_info_sealed_encrypted_string = await encrypt_seal_PII(user_info);

   User.updateOne({ _id: req.user.id}, {$set: {user_data: user_info_sealed_encrypted_string, username: req.body.username}}, function(err, res) {
    if (err) throw err;
    console.log("1 document updated");
   });
    
    res.redirect("/secrets");

  } else {
    res.redirect("/login");
  }

});

app.post("/doctor/update", async (req, res) => {
  if (req.isAuthenticated()) {
    const user_info = ({
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      mobile: req.body.mobile,
      hospital: req.body.hospital
    });

    user_info_sealed_encrypted_string = await encrypt_seal_PII(user_info);

   User.updateOne({ _id: req.user.id}, {$set: {user_data: user_info_sealed_encrypted_string, username: req.body.username}}, function(err, res) {
    if (err) throw err;
    console.log("1 document updated");
   });
    res.redirect(req.get('referer'));

  } else {
    res.redirect("/login");
  }
});

// file routes , submit and edit 
app.post("/submit", async (req, res) => {
  if (req.isAuthenticated) {
    upload.single('file')(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ message: "Upload Request Validation Failed" });
      } else if (!req.body.file_name) {
        return res.status(400).json({ message: "No photo name in request body" });
      }
      User.findById(req.user.id, async (err, foundUser) => {
        if(err){
                res.redirect("back")
                res.send('User not found with the proper ID')
        } else {
          //test passcode code
          if (req.body.passcode) {
            const match = await bcrypt.compare(req.body.passcode, foundUser.passcode);
            if (match) {
              console.log("correct passcode");
              console.log("password is correct and uploading file")
              let key = crypto.createHash("sha256").update(process.env.SERVER_SECRET).digest("hex");
              console.log("original file buffer before anything", req.file.buffer)
              let encrypted_bytes = myencrypt.encrypt_aes(req.file.buffer, key);
     
              let sealed_data = await enclave.seal_encrypted_data(encrypted_bytes);
              let buffer = Buffer.from(sealed_data);
              console.log("aes_encrytped and sealed", buffer);
              
              // Covert buffer to Readable Stream
              const readablePhotoStream = new Readable();
              readablePhotoStream.push(buffer);
              readablePhotoStream.push(null);
                
              let bucket = new mongodb.GridFSBucket(db, {
                bucketName: 'UserFiles'
              });
                
              let uploadStream = bucket.openUploadStream(req.file.originalname);

              const id = uploadStream.id;
              readablePhotoStream.pipe(uploadStream);
                
              // store owner and viewer rights of file
              
              const File_Rights = new FileRights({
                file_id: id,
                owner: req.user.id,
                name: req.body.file_name,
                type: req.file.mimetype,
              });
                                
              File_Rights.save();
              sucess_no = 1;
              uploadStream.on('error', () => {
                return res.status(500).json({ message: "Error uploading file" });
              });
              uploadStream.on('finish', () => {
               let upload = 1;
                res.redirect("/view?upload=" + upload);
              });
                
    
            } else { 
                res.send('The given password is incorrect!!') 
              }
            };
        }   
      }) 
    });
  } else {
    res.redirect("/login")
  }
});

app.post("/delete_file", async (req, res) => {
  if (req.isAuthenticated()) {
    console.log(req.body.file_id);
    const file_id = new mongoose.Types.ObjectId(req.body.file_id);
    let bucket = new mongodb.GridFSBucket(db, {
                bucketName: 'UserFiles'
    });
    // delete from gridfs 
    bucket.delete(file_id);
    // delete from user file
    await FileRights.deleteOne({ file_id: file_id });
    
    let deleted = 1;
    res.redirect("/view?delete=" + deleted);
  } else {
    res.redirect("/login");

  }
});

app.post("/delete_user", async (req, res) => {
  if (req.isAuthenticated()) {
    let match = await bcrypt.compare(req.body.passcode, req.user.passcode);
    if (match) {
      console.log("yebo, correct pincode and correct user");
      //first get all the file_ids of the owner and delete in the gridfs system
      let file_ids = await myquery.get_owner_files_ids(req.user.id);
      let bucket = new mongodb.GridFSBucket(db, {
                bucketName: 'UserFiles'
      });
      console.log(file_ids);
      for await (let i of file_ids) {
        let file = mongoose.Types.ObjectId(i);
        bucket.delete(file)
      }
      //delete all files associated with this user
      await FileRights.deleteMany({ owner: mongoose.Types.ObjectId(req.user.id) });
      
      //remove user as viewer in all viewing arrays of files
      let user_id = mongoose.Types.ObjectId(req.user.id)
      await myquery.remove_viewer_from_all_files(user_id);

      // finally remove user
      await User.deleteOne({ _id: req.user.id });
      
      res.redirect("/");
    }
    
  
    } else {
    res.redirect("/login");

  }

});
  


app.post("/editFile_name", async (req, res) => {
    if (req.isAuthenticated()) {
      console.log(req.body);
      await FileRights.updateOne({ file_id: req.body.fileId}, {$set: {name: req.body.fileName}}, function(err, res) { 
         if (err) throw err;
         console.log("1 filename updated");
       });
      let newfile = await myquery.get_file(req.body.fileId);
      let usernames = await myquery.get_all_user_usernames();
        let doc_usernames = await myquery.get_all_doc_usernames();
        let currentViewers = await myquery.get_current_viewers(file[0].viewers);
        res.render("edit_file", {file: newfile, usernames: usernames, currentViewers: currentViewers, doc_usernames: doc_usernames});
    } else {
      res.redirect("/login");
    }
});

app.post("/editFile", async (req, res) =>{
  if (req.isAuthenticated()) {
    console.log(req.body.bookId);
    let match = await bcrypt.compare(req.body.passcode, req.user.passcode);
    if (match) {
      console.log("yebo, correct pincode and correct user");
      let file = await myquery.get_file(req.body.bookId);
      console.log(file)
      if (file[0].owner == req.user.id) {
        console.log("yes its the correct owner");
        let usernames = await myquery.get_all_user_usernames();
        let doc_usernames = await myquery.get_all_doc_usernames();
        let currentViewers = await myquery.get_current_viewers(file[0].viewers);
        res.render("edit_file", {file: file, usernames: usernames, currentViewers: currentViewers, doc_usernames: doc_usernames});
      }
    }
  } else {
    res.redirect("/login");
  }
})

app.post("/editFile_addViewer", async (req, res) => {
    if (req.isAuthenticated()) {
       console.log(req.body);
       let viewer = req.body.username_id
       let newfile = await myquery.get_file(req.body.file_id);


      let match = await newfile[0].viewers.includes(viewer);
      if (!match) { // addd new user
           console.log("not a match");
           viewer_to_add = mongodb.ObjectID(req.body.username_id);
          FileRights.updateOne({ file_id: req.body.file_id }, { $push: { viewers: viewer_to_add } }, function (err, res) {
              if (err) throw err;
            console.log("1 viewer inserted");
               });
          } else {  
          console.log("is a match") }// already added user
      let usernames = await myquery.get_all_user_usernames();
      let doc_usernames = await myquery.get_all_doc_usernames();
      let updatedfile = await myquery.get_file(req.body.file_id);
        let currentViewers = await myquery.get_current_viewers(updatedfile[0].viewers);
        res.render("edit_file", {file: updatedfile, usernames: usernames, currentViewers: currentViewers, doc_usernames: doc_usernames});
    } else {
      res.redirect("/login");
    }
});

app.post("/editFile_removeViewer", async (req, res) => {
    if (req.isAuthenticated()) {
       console.log(req.body);
      viewer_to_remove = mongodb.ObjectID(req.body.username_id);
      await FileRights.updateOne({ file_id: req.body.file_id }, { $pull: { viewers: viewer_to_remove } }, function (err, res) {
              if (err) throw err;
            console.log("1 viewer remove");
               });

      let updatedfile = await myquery.get_file(req.body.file_id);
      let usernames = await myquery.get_all_user_usernames();
        let doc_usernames = await myquery.get_all_doc_usernames();
        let currentViewers = await myquery.get_current_viewers(updatedfile[0].viewers);
        res.render("edit_file", {file: updatedfile, usernames: usernames, currentViewers: currentViewers, doc_usernames: doc_usernames});
    } else {
      res.redirect("/login");
    }
});

// change to post later on
app.get("/seal_data", function (req, res) {
  // test   
  let data = [0, 1,2,3,4,5,6,7,8,9,10,11,12];
  console.log("original data before encryption", data);
  const key = crypto.createHash("sha256").update("123").digest("hex");

  let encrypted_bytes = myencrypt.encrypt_aes(data, key);
  console.log("aes encrypted byte stream", encrypted_bytes);

  let decrypted_aes_test = myencrypt.decrypt_aes(encrypted_bytes, key);
  console.log("test - original data after decryption", decrypted_aes_test);
  

  axios.post('http://localhost:8000//seal_encrypted_data', { "unsealed_data_received": encrypted_bytes })
    .then(response => {
      console.log(response.data);
/// for testing make the full loop to unseal
      axios.post('http://localhost:8000//unseal_encrypted_data', { "sealed_data_received": response.data})
    .then(response => {
      console.log("aes encrypted original data recived back after unsealing ", response.data);

      let decrypted_aes = myencrypt.decrypt_aes(response.data, key);
      console.log("original data after encryption",decrypted_aes);
      console.log(myencrypt.hexToBytes(decrypted_aes.toString("hex")));

    }, (error) => {
      console.log(error);
    });
//// testing above


    }, (error) => {
      console.log(error);
    });

 });


app.get("/axios_test", async (req, res) => {
  //let data = new Array(90000000).fill(1); //9.5367431640625 MB = 10000000 2147483647
  //let bytes = new Buffer.from(data); // 
  console.log((90000000 / 1024) / 1024);  //MB size
  //console.log(`${performance.memory.usedJSHeapSize / Math.pow(1000, 2)} MB`);
 
  console.log("original data before encryption", data);
  const key = crypto.createHash("sha256").update("123").digest("hex");

  let encrypted_bytes = myencrypt.encrypt_aes(data, key);
  console.log("aes encrypted byte stream: ", encrypted_bytes);
  //console.log(encry)

  const sealed_data = await enclave.seal_encrypted_data(encrypted_bytes);
  console.log("sealed data");
  console.log(sealed_data);

  let buffer = Buffer.from(sealed_data);
  console.log(buffer);
  console.log((buffer.byteLength / 1024) / 1024); 

  const unsealed_data = await enclave.unseal_encrypted_data(sealed_data);
  console.log("sealed data");
  console.log(sealed_data);
  let decrypted_aes = myencrypt.decrypt_aes(unsealed_data, key);
  console.log(" data after decryption", decrypted_aes);
  console.log(myencrypt.hexToBytes(decrypted_aes.toString("hex")));

  

});


let port = process.env.PORT;
if (port == null || port == "") {
  port = 3000;
}

app.listen(port, function () {
  console.log("Server started on port 3000.");
});

//// helper functions for parsing and sealing unsealing 


async function encrypt_seal_PII(user_info) {
  let key = crypto.createHash("sha256").update(process.env.SERVER_SECRET).digest("hex");
  json_stringify_user = JSON.stringify(user_info)
  console.log("json_stringify_user",json_stringify_user);
  //2. convert to buf
  json_stringify_buf_user = Buffer.from(json_stringify_user);
  console.log("json_stringify_buf_user", json_stringify_buf_user);
  ///// add encryption and decryption test  from 1 and then back to original // now add sealing and desealing
  encrypt = myencrypt.encrypt_aes(json_stringify_user, key); // same format as sealed in yellow

  // // // add sealing and unsealing
  let sealed_encrypted = await enclave.seal_encrypted_data(encrypt);
  console.log(sealed_encrypted); //JSON data [4,0,2,0] in yellow
  // convert to string because thats how its stored in MongoDB
  let string_sealed_encrypted = JSON.stringify(sealed_encrypted);
  console.log("string_sealed_encrypted", string_sealed_encrypted);
  return string_sealed_encrypted
}

async function decrypt_unseal_PII(user_info_sealed_encrypted_string) {
  let key = crypto.createHash("sha256").update(process.env.SERVER_SECRET).digest("hex");
  //convert from string back to JSON data in yellow
  let parse = JSON.parse(user_info_sealed_encrypted_string);
  console.log("parse", parse); // now its in yellow
  
  let unsealed_encrypted = await enclave.unseal_encrypted_data(parse);
  console.log("unsealed_encrypted", unsealed_encrypted); // now its in yellow and encrypted
  // now unseal and convert back 
  decrypt = myencrypt.decrypt_aes(unsealed_encrypted, key);
  console.log("decrypt", decrypt); //outputted as buffer

  decrypt_buf_to_json_string = decrypt.toString();
  decrypt_json_string_to_parse = JSON.parse(decrypt_buf_to_json_string);
  console.log("decrypt_json_string_to_parse", decrypt_json_string_to_parse);

  return decrypt_json_string_to_parse
};
 
async function decrypt_unseal_file(buffer, passcode) {
  let buffer_2 = JSON.parse(JSON.stringify(Buffer.concat(buffer))).data;
  let key = crypto.createHash("sha256").update(passcode).digest("hex");

  let unsealed_encrypted = await enclave.unseal_encrypted_data(buffer_2);
  console.log("unsealed_encrypted", unsealed_encrypted); // now its in yellow and encrypted
  decrypt = myencrypt.decrypt_aes(unsealed_encrypted, key);
  console.log("decrypted output", decrypt); //outputted as buffer
  return decrypt
 };



