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


// connect to mongodb
const connection = mongoose.connect("mongodb://localhost:27017/thesisPOC", {useNewUrlParser: true, useUnifiedTopology: true });
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

MongoClient.connect('mongodb://localhost', { useNewUrlParser: true, useUnifiedTopology: true }, (err, database) => {
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

app.get("/login", function(req, res){
  res.render("login");
});

app.get("/login_doctor", function(req, res){
  res.render("login_doctor");
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
    console.log("this is the true group: ",req.user.group)
    let user_data = await decrypt_unseal_PII(req.user.user_data);
   console.log(user_data);
    let files = await myquery.get_owner_files(req.user.id);

    if (req.user.group == "doctor") {
      console.log("this oak is a doctor");
        const user_info = ({
       username: req.user.username,
       firstName: user_data.firstName,
       lastName: user_data.lastName,
       mobile: user_data.mobile,
       hospital: user_data.hospital,
       group: req.user.group
      })

      console.log("userinfo", user_info);

      res.render("secrets_doctor", { userInfo: user_info, fileNo: files.length });
    } else if (req.user.group == "user") {
      console.log("this oak is a user");
      const user_info = ({
      username: req.user.username,
      firstName: user_data.firstName,
      lastName: user_data.lastName,
      mobile: user_data.mobile,
      group: req.user.group
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
    var success = req.query.upload;
    console.log(success);
    let files = await myquery.get_owner_files(req.user.id);
    res.render("view",{ userData: files , success: success});
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

// post routes
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
              let key = crypto.createHash("sha256").update(req.body.passcode).digest("hex");
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
                var upload = encodeURIComponent('1')
                return res.redirect("/view?upload=" + upload);
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

app.get("/otp_modal", async (req, res) => {
  res.render("otp_modal");

});


app.get("/users/view/", async (req, res) => {
  if (req.isAuthenticated()) {
    console.log(req.query.file);
    console.log(req.query.type)
    const passcode = '1234';

    const awe = await bcrypt.compare('1234', '$2b$14$HRgSU3OdNjmPhjgqLUntmeiBUo./GOE9R0EOcCB0ekdD22XS3urBe')
    console.log(awe);
 
    id_test = new mongodb.ObjectID(req.query.file);

    let bucket = new mongodb.GridFSBucket(db, {
      bucketName: 'UserFiles' 
    });
        
    let downloadStream = bucket.openDownloadStream(id_test);
    const chunks = [];

    for await (let chunk of downloadStream) {
        chunks.push(Buffer.from(chunk));
      }

    let buffer_2 = await decrypt_unseal_file(chunks, passcode)
    console.log("this is the final image buffer", buffer_2);
      
    res.contentType(req.query.type);
    res.send(buffer_2);
  } else {
    res.redirect("/login");
  }
});


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

app.post("/login", function(req, res){

  const user = new User({
    username: req.body.username,
    password: req.body.password
  });

  req.login(user, function(err){
    if (err) {
      console.log(err);
    } else {
      passport.authenticate("local")(req, res, function(){
        res.redirect("/secrets");
      });
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
    } else {
      console.log(User);
      passport.authenticate("local")(req, res, function () {
        console.log("Successful login of doctor");
        res.redirect("/secrets");
      });
    }
  });

});

app.get("/users/edit/", async (req, res) =>{
  if (req.isAuthenticated()) {
    console.log(req.query.file);
    let file = await myquery.get_file(req.query.file);
    res.render("edit",{ file: file });
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


app.listen(3000, function() {
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



