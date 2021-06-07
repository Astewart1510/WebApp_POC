var mongoose = require('mongoose');
const mongodb = require('mongodb');
const passportLocalMongoose = require("passport-local-mongoose");
const findOrCreate = require('mongoose-findorcreate');

var Schema = mongoose.Schema;

const fileRightsSchema = new mongoose.Schema({
  file_id: { type: Schema.Types.ObjectId, ref: 'UserFiles' },
  owner: {
    type: Schema.Types.ObjectId, ref: 'users', required: true
  },
  name: String,
  type: String,
  viewers: [{ type: Schema.Types.ObjectId, ref: 'users' }]
});

const userSchema = new mongoose.Schema ({
  username: String,
  group: {
        type: String,
        enum : ['user','doctor'],
        default: 'user'
    },
  user_data: String,
  passcode: String
});


userSchema.plugin(passportLocalMongoose);
userSchema.plugin(findOrCreate);


module.exports = {

  FileRights: new mongoose.model("FileRights", fileRightsSchema),
  User: new mongoose.model("User", userSchema),
     
}
    