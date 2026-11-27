import{bm as $,bn as ue,bo as ce,bp as le,bq as he,br as de,bs as Y,bt as fe,bu as pe,bv as _e,bw as ge,bx as z,by as me,bz as be}from"./index-ekud9OCS.js";/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Z="firebasestorage.googleapis.com",J="storageBucket",Re=120*1e3,we=600*1e3;/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class l extends de{constructor(t,n,s=0){super(L(t),`Firebase Storage: ${n} (${L(t)})`),this.status_=s,this.customData={serverResponse:null},this._baseMessage=this.message,Object.setPrototypeOf(this,l.prototype)}get status(){return this.status_}set status(t){this.status_=t}_codeEquals(t){return L(t)===this.code}get serverResponse(){return this.customData.serverResponse}set serverResponse(t){this.customData.serverResponse=t,this.customData.serverResponse?this.message=`${this._baseMessage}
${this.customData.serverResponse}`:this.message=this._baseMessage}}var c;(function(e){e.UNKNOWN="unknown",e.OBJECT_NOT_FOUND="object-not-found",e.BUCKET_NOT_FOUND="bucket-not-found",e.PROJECT_NOT_FOUND="project-not-found",e.QUOTA_EXCEEDED="quota-exceeded",e.UNAUTHENTICATED="unauthenticated",e.UNAUTHORIZED="unauthorized",e.UNAUTHORIZED_APP="unauthorized-app",e.RETRY_LIMIT_EXCEEDED="retry-limit-exceeded",e.INVALID_CHECKSUM="invalid-checksum",e.CANCELED="canceled",e.INVALID_EVENT_NAME="invalid-event-name",e.INVALID_URL="invalid-url",e.INVALID_DEFAULT_BUCKET="invalid-default-bucket",e.NO_DEFAULT_BUCKET="no-default-bucket",e.CANNOT_SLICE_BLOB="cannot-slice-blob",e.SERVER_FILE_WRONG_SIZE="server-file-wrong-size",e.NO_DOWNLOAD_URL="no-download-url",e.INVALID_ARGUMENT="invalid-argument",e.INVALID_ARGUMENT_COUNT="invalid-argument-count",e.APP_DELETED="app-deleted",e.INVALID_ROOT_OPERATION="invalid-root-operation",e.INVALID_FORMAT="invalid-format",e.INTERNAL_ERROR="internal-error",e.UNSUPPORTED_ENVIRONMENT="unsupported-environment"})(c||(c={}));function L(e){return"storage/"+e}function H(){const e="An unknown error occurred, please check the error payload for server response.";return new l(c.UNKNOWN,e)}function Te(e){return new l(c.QUOTA_EXCEEDED,"Quota for bucket '"+e+"' exceeded, please view quota on https://firebase.google.com/pricing/.")}function ye(){const e="User is not authenticated, please authenticate using Firebase Authentication and try again.";return new l(c.UNAUTHENTICATED,e)}function ke(){return new l(c.UNAUTHORIZED_APP,"This app does not have permission to access Firebase Storage on this project.")}function Ee(e){return new l(c.UNAUTHORIZED,"User does not have permission to access '"+e+"'.")}function Ae(){return new l(c.RETRY_LIMIT_EXCEEDED,"Max retry time for operation exceeded, please try again.")}function Ue(){return new l(c.CANCELED,"User canceled the upload/download.")}function Oe(e){return new l(c.INVALID_URL,"Invalid URL '"+e+"'.")}function Ie(e){return new l(c.INVALID_DEFAULT_BUCKET,"Invalid default bucket '"+e+"'.")}function Ne(){return new l(c.NO_DEFAULT_BUCKET,"No default bucket found. Did you set the '"+J+"' property when initializing the app?")}function Ce(){return new l(c.CANNOT_SLICE_BLOB,"Cannot slice blob for upload. Please retry the upload.")}function Pe(e){return new l(c.UNSUPPORTED_ENVIRONMENT,`${e} is missing. Make sure to install the required polyfills. See https://firebase.google.com/docs/web/environments-js-sdk#polyfills for more information.`)}function F(e){return new l(c.INVALID_ARGUMENT,e)}function Q(){return new l(c.APP_DELETED,"The Firebase app was deleted.")}function xe(e){return new l(c.INVALID_ROOT_OPERATION,"The operation '"+e+"' cannot be performed on a root reference, create a non-root reference using child, such as .child('file.png').")}function C(e,t){return new l(c.INVALID_FORMAT,"String does not match format '"+e+"': "+t)}function N(e){throw new l(c.INTERNAL_ERROR,"Internal error: "+e)}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class g{constructor(t,n){this.bucket=t,this.path_=n}get path(){return this.path_}get isRoot(){return this.path.length===0}fullServerUrl(){const t=encodeURIComponent;return"/b/"+t(this.bucket)+"/o/"+t(this.path)}bucketOnlyServerUrl(){return"/b/"+encodeURIComponent(this.bucket)+"/o"}static makeFromBucketSpec(t,n){let s;try{s=g.makeFromUrl(t,n)}catch{return new g(t,"")}if(s.path==="")return s;throw Ie(t)}static makeFromUrl(t,n){let s=null;const r="([A-Za-z0-9.\\-_]+)";function i(_){_.path.charAt(_.path.length-1)==="/"&&(_.path_=_.path_.slice(0,-1))}const o="(/(.*))?$",u=new RegExp("^gs://"+r+o,"i"),a={bucket:1,path:3};function h(_){_.path_=decodeURIComponent(_.path)}const d="v[A-Za-z0-9_]+",w=n.replace(/[.]/g,"\\."),m="(/([^?#]*).*)?$",T=new RegExp(`^https?://${w}/${d}/b/${r}/o${m}`,"i"),y={bucket:1,path:3},k=n===Z?"(?:storage.googleapis.com|storage.cloud.google.com)":n,p="([^?#]*)",I=new RegExp(`^https?://${k}/${r}/${p}`,"i"),b=[{regex:u,indices:a,postModify:i},{regex:T,indices:y,postModify:h},{regex:I,indices:{bucket:1,path:2},postModify:h}];for(let _=0;_<b.length;_++){const P=b[_],v=P.regex.exec(t);if(v){const ae=v[P.indices.bucket];let S=v[P.indices.path];S||(S=""),s=new g(ae,S),P.postModify(s);break}}if(s==null)throw Oe(t);return s}}class De{constructor(t){this.promise_=Promise.reject(t)}getPromise(){return this.promise_}cancel(t=!1){}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function ve(e,t,n){let s=1,r=null,i=null,o=!1,u=0;function a(){return u===2}let h=!1;function d(...p){h||(h=!0,t.apply(null,p))}function w(p){r=setTimeout(()=>{r=null,e(T,a())},p)}function m(){i&&clearTimeout(i)}function T(p,...I){if(h){m();return}if(p){m(),d.call(null,p,...I);return}if(a()||o){m(),d.call(null,p,...I);return}s<64&&(s*=2);let b;u===1?(u=2,b=0):b=(s+Math.random())*1e3,w(b)}let y=!1;function k(p){y||(y=!0,m(),!h&&(r!==null?(p||(u=2),clearTimeout(r),w(0)):p||(u=1)))}return w(0),i=setTimeout(()=>{o=!0,k(!0)},n),k}function Se(e){e(!1)}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Le(e){return e!==void 0}function Be(e){return typeof e=="object"&&!Array.isArray(e)}function ee(e){return typeof e=="string"||e instanceof String}function q(e){return V()&&e instanceof Blob}function V(){return typeof Blob<"u"}function W(e,t,n,s){if(s<t)throw F(`Invalid value for '${e}'. Expected ${t} or greater.`);if(s>n)throw F(`Invalid value for '${e}'. Expected ${n} or less.`)}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Me(e,t,n){let s=t;return n==null&&(s=`https://${t}`),`${n}://${s}/v0${e}`}function Fe(e){const t=encodeURIComponent;let n="?";for(const s in e)if(e.hasOwnProperty(s)){const r=t(s)+"="+t(e[s]);n=n+r+"&"}return n=n.slice(0,-1),n}var U;(function(e){e[e.NO_ERROR=0]="NO_ERROR",e[e.NETWORK_ERROR=1]="NETWORK_ERROR",e[e.ABORT=2]="ABORT"})(U||(U={}));/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function $e(e,t){const n=e>=500&&e<600,r=[408,429].indexOf(e)!==-1,i=t.indexOf(e)!==-1;return n||r||i}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class He{constructor(t,n,s,r,i,o,u,a,h,d,w,m=!0,T=!1){this.url_=t,this.method_=n,this.headers_=s,this.body_=r,this.successCodes_=i,this.additionalRetryCodes_=o,this.callback_=u,this.errorCallback_=a,this.timeout_=h,this.progressCallback_=d,this.connectionFactory_=w,this.retry=m,this.isUsingEmulator=T,this.pendingConnection_=null,this.backoffId_=null,this.canceled_=!1,this.appDelete_=!1,this.promise_=new Promise((y,k)=>{this.resolve_=y,this.reject_=k,this.start_()})}start_(){const t=(s,r)=>{if(r){s(!1,new x(!1,null,!0));return}const i=this.connectionFactory_();this.pendingConnection_=i;const o=u=>{const a=u.loaded,h=u.lengthComputable?u.total:-1;this.progressCallback_!==null&&this.progressCallback_(a,h)};this.progressCallback_!==null&&i.addUploadProgressListener(o),i.send(this.url_,this.method_,this.isUsingEmulator,this.body_,this.headers_).then(()=>{this.progressCallback_!==null&&i.removeUploadProgressListener(o),this.pendingConnection_=null;const u=i.getErrorCode()===U.NO_ERROR,a=i.getStatus();if(!u||$e(a,this.additionalRetryCodes_)&&this.retry){const d=i.getErrorCode()===U.ABORT;s(!1,new x(!1,null,d));return}const h=this.successCodes_.indexOf(a)!==-1;s(!0,new x(h,i))})},n=(s,r)=>{const i=this.resolve_,o=this.reject_,u=r.connection;if(r.wasSuccessCode)try{const a=this.callback_(u,u.getResponse());Le(a)?i(a):i()}catch(a){o(a)}else if(u!==null){const a=H();a.serverResponse=u.getErrorText(),this.errorCallback_?o(this.errorCallback_(u,a)):o(a)}else if(r.canceled){const a=this.appDelete_?Q():Ue();o(a)}else{const a=Ae();o(a)}};this.canceled_?n(!1,new x(!1,null,!0)):this.backoffId_=ve(t,n,this.timeout_)}getPromise(){return this.promise_}cancel(t){this.canceled_=!0,this.appDelete_=t||!1,this.backoffId_!==null&&Se(this.backoffId_),this.pendingConnection_!==null&&this.pendingConnection_.abort()}}class x{constructor(t,n,s){this.wasSuccessCode=t,this.connection=n,this.canceled=!!s}}function Ve(e,t){t!==null&&t.length>0&&(e.Authorization="Firebase "+t)}function je(e,t){e["X-Firebase-Storage-Version"]="webjs/"+(t??"AppManager")}function ze(e,t){t&&(e["X-Firebase-GMPID"]=t)}function qe(e,t){t!==null&&(e["X-Firebase-AppCheck"]=t)}function We(e,t,n,s,r,i,o=!0,u=!1){const a=Fe(e.urlParams),h=e.url+a,d=Object.assign({},e.headers);return ze(d,t),Ve(d,n),je(d,i),qe(d,s),new He(h,e.method,d,e.body,e.successCodes,e.additionalRetryCodes,e.handler,e.errorHandler,e.timeout,e.progressCallback,r,o,u)}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Xe(){return typeof BlobBuilder<"u"?BlobBuilder:typeof WebKitBlobBuilder<"u"?WebKitBlobBuilder:void 0}function Ke(...e){const t=Xe();if(t!==void 0){const n=new t;for(let s=0;s<e.length;s++)n.append(e[s]);return n.getBlob()}else{if(V())return new Blob(e);throw new l(c.UNSUPPORTED_ENVIRONMENT,"This browser doesn't seem to support creating Blobs")}}function Ge(e,t,n){return e.webkitSlice?e.webkitSlice(t,n):e.mozSlice?e.mozSlice(t,n):e.slice?e.slice(t,n):null}/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Ye(e){if(typeof atob>"u")throw Pe("base-64");return atob(e)}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const R={RAW:"raw",BASE64:"base64",BASE64URL:"base64url",DATA_URL:"data_url"};class B{constructor(t,n){this.data=t,this.contentType=n||null}}function Ze(e,t){switch(e){case R.RAW:return new B(te(t));case R.BASE64:case R.BASE64URL:return new B(ne(e,t));case R.DATA_URL:return new B(Qe(t),et(t))}throw H()}function te(e){const t=[];for(let n=0;n<e.length;n++){let s=e.charCodeAt(n);if(s<=127)t.push(s);else if(s<=2047)t.push(192|s>>6,128|s&63);else if((s&64512)===55296)if(!(n<e.length-1&&(e.charCodeAt(n+1)&64512)===56320))t.push(239,191,189);else{const i=s,o=e.charCodeAt(++n);s=65536|(i&1023)<<10|o&1023,t.push(240|s>>18,128|s>>12&63,128|s>>6&63,128|s&63)}else(s&64512)===56320?t.push(239,191,189):t.push(224|s>>12,128|s>>6&63,128|s&63)}return new Uint8Array(t)}function Je(e){let t;try{t=decodeURIComponent(e)}catch{throw C(R.DATA_URL,"Malformed data URL.")}return te(t)}function ne(e,t){switch(e){case R.BASE64:{const r=t.indexOf("-")!==-1,i=t.indexOf("_")!==-1;if(r||i)throw C(e,"Invalid character '"+(r?"-":"_")+"' found: is it base64url encoded?");break}case R.BASE64URL:{const r=t.indexOf("+")!==-1,i=t.indexOf("/")!==-1;if(r||i)throw C(e,"Invalid character '"+(r?"+":"/")+"' found: is it base64 encoded?");t=t.replace(/-/g,"+").replace(/_/g,"/");break}}let n;try{n=Ye(t)}catch(r){throw r.message.includes("polyfill")?r:C(e,"Invalid character found")}const s=new Uint8Array(n.length);for(let r=0;r<n.length;r++)s[r]=n.charCodeAt(r);return s}class se{constructor(t){this.base64=!1,this.contentType=null;const n=t.match(/^data:([^,]+)?,/);if(n===null)throw C(R.DATA_URL,"Must be formatted 'data:[<mediatype>][;base64],<data>");const s=n[1]||null;s!=null&&(this.base64=tt(s,";base64"),this.contentType=this.base64?s.substring(0,s.length-7):s),this.rest=t.substring(t.indexOf(",")+1)}}function Qe(e){const t=new se(e);return t.base64?ne(R.BASE64,t.rest):Je(t.rest)}function et(e){return new se(e).contentType}function tt(e,t){return e.length>=t.length?e.substring(e.length-t.length)===t:!1}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class E{constructor(t,n){let s=0,r="";q(t)?(this.data_=t,s=t.size,r=t.type):t instanceof ArrayBuffer?(n?this.data_=new Uint8Array(t):(this.data_=new Uint8Array(t.byteLength),this.data_.set(new Uint8Array(t))),s=this.data_.length):t instanceof Uint8Array&&(n?this.data_=t:(this.data_=new Uint8Array(t.length),this.data_.set(t)),s=t.length),this.size_=s,this.type_=r}size(){return this.size_}type(){return this.type_}slice(t,n){if(q(this.data_)){const s=this.data_,r=Ge(s,t,n);return r===null?null:new E(r)}else{const s=new Uint8Array(this.data_.buffer,t,n-t);return new E(s,!0)}}static getBlob(...t){if(V()){const n=t.map(s=>s instanceof E?s.data_:s);return new E(Ke.apply(null,n))}else{const n=t.map(o=>ee(o)?Ze(R.RAW,o).data:o.data_);let s=0;n.forEach(o=>{s+=o.byteLength});const r=new Uint8Array(s);let i=0;return n.forEach(o=>{for(let u=0;u<o.length;u++)r[i++]=o[u]}),new E(r,!0)}}uploadData(){return this.data_}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function nt(e){let t;try{t=JSON.parse(e)}catch{return null}return Be(t)?t:null}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function st(e){if(e.length===0)return null;const t=e.lastIndexOf("/");return t===-1?"":e.slice(0,t)}function rt(e,t){const n=t.split("/").filter(s=>s.length>0).join("/");return e.length===0?n:e+"/"+n}function re(e){const t=e.lastIndexOf("/",e.length-2);return t===-1?e:e.slice(t+1)}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function it(e,t){return t}class f{constructor(t,n,s,r){this.server=t,this.local=n||t,this.writable=!!s,this.xform=r||it}}let D=null;function ot(e){return!ee(e)||e.length<2?e:re(e)}function at(){if(D)return D;const e=[];e.push(new f("bucket")),e.push(new f("generation")),e.push(new f("metageneration")),e.push(new f("name","fullPath",!0));function t(i,o){return ot(o)}const n=new f("name");n.xform=t,e.push(n);function s(i,o){return o!==void 0?Number(o):o}const r=new f("size");return r.xform=s,e.push(r),e.push(new f("timeCreated")),e.push(new f("updated")),e.push(new f("md5Hash",null,!0)),e.push(new f("cacheControl",null,!0)),e.push(new f("contentDisposition",null,!0)),e.push(new f("contentEncoding",null,!0)),e.push(new f("contentLanguage",null,!0)),e.push(new f("contentType",null,!0)),e.push(new f("metadata","customMetadata",!0)),D=e,D}function ut(e,t){function n(){const s=e.bucket,r=e.fullPath,i=new g(s,r);return t._makeStorageReference(i)}Object.defineProperty(e,"ref",{get:n})}function ct(e,t,n){const s={};s.type="file";const r=n.length;for(let i=0;i<r;i++){const o=n[i];s[o.local]=o.xform(s,t[o.server])}return ut(s,e),s}function lt(e,t,n){const s=nt(t);return s===null?null:ct(e,s,n)}function ht(e,t){const n={},s=t.length;for(let r=0;r<s;r++){const i=t[r];i.writable&&(n[i.server]=e[i.local])}return JSON.stringify(n)}class dt{constructor(t,n,s,r){this.url=t,this.method=n,this.handler=s,this.timeout=r,this.urlParams={},this.headers={},this.body=null,this.errorHandler=null,this.progressCallback=null,this.successCodes=[200],this.additionalRetryCodes=[]}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function ft(e){if(!e)throw H()}function pt(e,t){function n(s,r){const i=lt(e,r,t);return ft(i!==null),i}return n}function _t(e){function t(n,s){let r;return n.getStatus()===401?n.getErrorText().includes("Firebase App Check token is invalid")?r=ke():r=ye():n.getStatus()===402?r=Te(e.bucket):n.getStatus()===403?r=Ee(e.path):r=s,r.status=n.getStatus(),r.serverResponse=s.serverResponse,r}return t}function gt(e,t){return e&&e.contentType||t&&t.type()||"application/octet-stream"}function mt(e,t,n){const s=Object.assign({},n);return s.fullPath=e.path,s.size=t.size(),s.contentType||(s.contentType=gt(null,t)),s}function bt(e,t,n,s,r){const i=t.bucketOnlyServerUrl(),o={"X-Goog-Upload-Protocol":"multipart"};function u(){let b="";for(let _=0;_<2;_++)b=b+Math.random().toString().slice(2);return b}const a=u();o["Content-Type"]="multipart/related; boundary="+a;const h=mt(t,s,r),d=ht(h,n),w="--"+a+`\r
Content-Type: application/json; charset=utf-8\r
\r
`+d+`\r
--`+a+`\r
Content-Type: `+h.contentType+`\r
\r
`,m=`\r
--`+a+"--",T=E.getBlob(w,s,m);if(T===null)throw Ce();const y={name:h.fullPath},k=Me(i,e.host,e._protocol),p="POST",I=e.maxUploadRetryTime,A=new dt(k,p,pt(e,n),I);return A.urlParams=y,A.headers=o,A.body=T.uploadData(),A.errorHandler=_t(t),A}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Rt{constructor(){this.sent_=!1,this.xhr_=new XMLHttpRequest,this.initXhr(),this.errorCode_=U.NO_ERROR,this.sendPromise_=new Promise(t=>{this.xhr_.addEventListener("abort",()=>{this.errorCode_=U.ABORT,t()}),this.xhr_.addEventListener("error",()=>{this.errorCode_=U.NETWORK_ERROR,t()}),this.xhr_.addEventListener("load",()=>{t()})})}send(t,n,s,r,i){if(this.sent_)throw N("cannot .send() more than once");if(Y(t)&&s&&(this.xhr_.withCredentials=!0),this.sent_=!0,this.xhr_.open(n,t,!0),i!==void 0)for(const o in i)i.hasOwnProperty(o)&&this.xhr_.setRequestHeader(o,i[o].toString());return r!==void 0?this.xhr_.send(r):this.xhr_.send(),this.sendPromise_}getErrorCode(){if(!this.sent_)throw N("cannot .getErrorCode() before sending");return this.errorCode_}getStatus(){if(!this.sent_)throw N("cannot .getStatus() before sending");try{return this.xhr_.status}catch{return-1}}getResponse(){if(!this.sent_)throw N("cannot .getResponse() before sending");return this.xhr_.response}getErrorText(){if(!this.sent_)throw N("cannot .getErrorText() before sending");return this.xhr_.statusText}abort(){this.xhr_.abort()}getResponseHeader(t){return this.xhr_.getResponseHeader(t)}addUploadProgressListener(t){this.xhr_.upload!=null&&this.xhr_.upload.addEventListener("progress",t)}removeUploadProgressListener(t){this.xhr_.upload!=null&&this.xhr_.upload.removeEventListener("progress",t)}}class wt extends Rt{initXhr(){this.xhr_.responseType="text"}}function Tt(){return new wt}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class O{constructor(t,n){this._service=t,n instanceof g?this._location=n:this._location=g.makeFromUrl(n,t.host)}toString(){return"gs://"+this._location.bucket+"/"+this._location.path}_newRef(t,n){return new O(t,n)}get root(){const t=new g(this._location.bucket,"");return this._newRef(this._service,t)}get bucket(){return this._location.bucket}get fullPath(){return this._location.path}get name(){return re(this._location.path)}get storage(){return this._service}get parent(){const t=st(this._location.path);if(t===null)return null;const n=new g(this._location.bucket,t);return new O(this._service,n)}_throwIfRoot(t){if(this._location.path==="")throw xe(t)}}function yt(e,t,n){e._throwIfRoot("uploadBytes");const s=bt(e.storage,e._location,at(),new E(t,!0),n);return e.storage.makeRequestWithTokens(s,Tt).then(r=>({metadata:r,ref:e}))}function kt(e,t){const n=rt(e._location.path,t),s=new g(e._location.bucket,n);return new O(e.storage,s)}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Et(e){return/^[A-Za-z]+:\/\//.test(e)}function At(e,t){return new O(e,t)}function ie(e,t){if(e instanceof j){const n=e;if(n._bucket==null)throw Ne();const s=new O(n,n._bucket);return t!=null?ie(s,t):s}else return t!==void 0?kt(e,t):e}function Ut(e,t){if(t&&Et(t)){if(e instanceof j)return At(e,t);throw F("To use ref(service, url), the first argument must be a Storage instance.")}else return ie(e,t)}function X(e,t){const n=t==null?void 0:t[J];return n==null?null:g.makeFromBucketSpec(n,e)}function Ot(e,t,n,s={}){e.host=`${t}:${n}`;const r=Y(t);r&&fe(`https://${e.host}/b`),e._isUsingEmulator=!0,e._protocol=r?"https":"http";const{mockUserToken:i}=s;i&&(e._overrideAuthToken=typeof i=="string"?i:pe(i,e.app.options.projectId))}class j{constructor(t,n,s,r,i,o=!1){this.app=t,this._authProvider=n,this._appCheckProvider=s,this._url=r,this._firebaseVersion=i,this._isUsingEmulator=o,this._bucket=null,this._host=Z,this._protocol="https",this._appId=null,this._deleted=!1,this._maxOperationRetryTime=Re,this._maxUploadRetryTime=we,this._requests=new Set,r!=null?this._bucket=g.makeFromBucketSpec(r,this._host):this._bucket=X(this._host,this.app.options)}get host(){return this._host}set host(t){this._host=t,this._url!=null?this._bucket=g.makeFromBucketSpec(this._url,t):this._bucket=X(t,this.app.options)}get maxUploadRetryTime(){return this._maxUploadRetryTime}set maxUploadRetryTime(t){W("time",0,Number.POSITIVE_INFINITY,t),this._maxUploadRetryTime=t}get maxOperationRetryTime(){return this._maxOperationRetryTime}set maxOperationRetryTime(t){W("time",0,Number.POSITIVE_INFINITY,t),this._maxOperationRetryTime=t}async _getAuthToken(){if(this._overrideAuthToken)return this._overrideAuthToken;const t=this._authProvider.getImmediate({optional:!0});if(t){const n=await t.getToken();if(n!==null)return n.accessToken}return null}async _getAppCheckToken(){if(he(this.app)&&this.app.settings.appCheckToken)return this.app.settings.appCheckToken;const t=this._appCheckProvider.getImmediate({optional:!0});return t?(await t.getToken()).token:null}_delete(){return this._deleted||(this._deleted=!0,this._requests.forEach(t=>t.cancel()),this._requests.clear()),Promise.resolve()}_makeStorageReference(t){return new O(this,t)}_makeRequest(t,n,s,r,i=!0){if(this._deleted)return new De(Q());{const o=We(t,this._appId,s,r,n,this._firebaseVersion,i,this._isUsingEmulator);return this._requests.add(o),o.getPromise().then(()=>this._requests.delete(o),()=>this._requests.delete(o)),o}}async makeRequestWithTokens(t,n){const[s,r]=await Promise.all([this._getAuthToken(),this._getAppCheckToken()]);return this._makeRequest(t,n,s,r).getPromise()}}const K="@firebase/storage",G="0.14.4";/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const oe="storage";function It(e,t,n){return e=$(e),yt(e,t,n)}function Nt(e,t){return e=$(e),Ut(e,t)}function Ct(e=le(),t){e=$(e);const s=ue(e,oe).getImmediate({identifier:t}),r=ce("storage");return r&&Pt(s,...r),s}function Pt(e,t,n,s={}){Ot(e,t,n,s)}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function xt(e,{instanceIdentifier:t}){const n=e.getProvider("app").getImmediate(),s=e.getProvider("auth-internal"),r=e.getProvider("app-check-internal");return new j(n,s,r,t,me)}function Dt(){_e(new ge(oe,xt,"PUBLIC").setMultipleInstances(!0)),z(K,G,""),z(K,G,"esm2020")}Dt();let M;function vt(){return M||(M=Ct(be)),M}async function Lt(e,t=vt()){await It(Nt(t,e.key),e.blob,{contentType:e.contentType,customMetadata:{itemId:e.itemId,photoVersion:String(e.version),source:"upload",originalName:e.name.slice(0,200)}})}export{Lt as uploadOriginal};
