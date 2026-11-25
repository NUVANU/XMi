using System;
using System.IO;
using System.Text;
using System.Net;
using System.Net.Sockets;
using System.Diagnostics;
using System.Reflection;
using System.Collections.Generic;
using System.Security;
using System.Security.Cryptography;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
class Worker {
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetTokenInformation(IntPtr token,int kind,out int value,int length,out int needed);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static bool IsContainer(){IntPtr token;if(!OpenProcessToken(GetCurrentProcess(),8,out token))return false;try{int value,needed;return GetTokenInformation(token,29,out value,4,out needed)&&value==1;}finally{CloseHandle(token);}}
  static Dictionary<string,object> Row(string name,string access,string code){var row=new Dictionary<string,object>();row["name"]=name;row["access"]=access;if(code!=null)row["code"]=code;return row;}
  static Dictionary<string,object> Attempt(string name,Action action){try{action();return Row(name,"ALLOWED",null);}catch(UnauthorizedAccessException){return Row(name,"DENIED_OR_ERROR","EACCES");}catch(SecurityException){return Row(name,"DENIED_OR_ERROR","EACCES");}catch(Exception ex){return Row(name,"ERROR",ex.GetType().Name);}}
  static int Main(string[] args){
    Console.OutputEncoding=new UTF8Encoding(false);
    if(args.Length==2&&args[0]=="--child"){
      try{File.ReadAllBytes(args[1]);return 11;}catch(UnauthorizedAccessException){return IsContainer()?42:43;}catch(SecurityException){return IsContainer()?42:43;}catch{return 44;}
    }
    string exe=Assembly.GetExecutingAssembly().Location,runtime=Path.GetDirectoryName(exe),root=Path.GetDirectoryName(runtime);
    byte[] originalMaterial=File.ReadAllBytes(Path.Combine(root,"frozen/material.json"));
    var rows=new List<Dictionary<string,object>>();
    var frozen=Attempt("read_frozen_material",delegate{File.ReadAllBytes(Path.Combine(root,"frozen/material.json"));});
    if((string)frozen["access"]=="ALLOWED")using(var sha=new SHA256Managed())frozen["sha256"]=BitConverter.ToString(sha.ComputeHash(File.ReadAllBytes(Path.Combine(root,"frozen/material.json")))).Replace("-","").ToLowerInvariant();
    rows.Add(frozen);
    rows.Add(Attempt("write_frozen_material",delegate{File.AppendAllText(Path.Combine(root,"frozen/material.json"),"\nSYNTHETIC_WRITE");}));
    rows.Add(Attempt("read_simulated_project",delegate{File.ReadAllBytes(Path.Combine(root,"simulated-project/canonical.json"));}));
    rows.Add(Attempt("write_simulated_project",delegate{File.AppendAllText(Path.Combine(root,"simulated-project/canonical.json"),"\nSYNTHETIC_WRITE");}));
    rows.Add(Attempt("read_other_project",delegate{File.ReadAllBytes(Path.Combine(root,"forbidden/other-project.txt"));}));
    rows.Add(Attempt("read_simulated_secret",delegate{File.ReadAllBytes(Path.Combine(root,"forbidden/synthetic-secret.env"));}));
    var childRow=Row("child_read_simulated_secret","ERROR",null);
    try{
      var info=new ProcessStartInfo(exe,"--child \""+Path.Combine(root,"forbidden/synthetic-secret.env")+"\"");
      info.UseShellExecute=false;info.CreateNoWindow=true;
      using(var child=Process.Start(info)){
        if(!child.WaitForExit(3000)){child.Kill();childRow["code"]="CHILD_TIMEOUT";}
        else{childRow["child_exit_code"]=child.ExitCode;
          if(child.ExitCode==11)childRow["access"]="ALLOWED";
          else if(child.ExitCode==42){childRow["access"]="DENIED_OR_ERROR";childRow["code"]="EACCES";childRow["child_appcontainer_verified"]=true;}
          else childRow["code"]="CHILD_RESULT_UNVERIFIED";
        }
      }
    }catch(Exception ex){childRow["code"]=ex.GetType().Name;}
    rows.Add(childRow);
    var serializer=new JavaScriptSerializer();serializer.MaxJsonLength=8*1024*1024;
    var settings=serializer.Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(runtime,"job.json")));
    var binding=(Dictionary<string,object>)settings["job"];
    string fileHash=(string)frozen["sha256"];
    var packet=serializer.Deserialize<Dictionary<string,object>>(Encoding.UTF8.GetString(originalMaterial));
    string materialHash;
    using(var sha=SHA256.Create())materialHash=BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes((string)packet["material"]))).Replace("-","").ToLowerInvariant();
    bool bound=fileHash==(string)settings["bundle_file_sha256"]&&materialHash==(string)binding["material_sha256"]&&
      (string)packet["project_id"]==(string)binding["project_id"]&&Convert.ToInt32(packet["product_model_version"])==Convert.ToInt32(binding["model_version"])&&
      (string)packet["model_sha256"]==(string)binding["model_sha256"]&&(string)packet["bundle_sha256"]==(string)binding["bundle_sha256"];
    bool restricted=IsContainer();
    Console.WriteLine(serializer.Serialize(new {stage="REQUEST",scope="FROZEN_SPEC_REVIEW",appcontainer=restricted,results=rows,
      binding_valid=bound,bundle_file_sha256=fileHash,job=binding,requests=settings["calls"]}));Console.Out.Flush();
    if(!restricted)return bound?0:7;
    string responsePath=Path.Combine(root,"frozen/response.json");
    DateTime deadline=DateTime.UtcNow.AddSeconds(950);
    while(DateTime.UtcNow<deadline){
      string text=File.ReadAllText(responsePath);
      if(text.Length>2){
        try{
          var response=serializer.Deserialize<Dictionary<string,object>>(text);
          if(response.ContainsKey("ready")&&Convert.ToBoolean(response["ready"])){
            bool matches=(string)response["native_run_id"]==(string)binding["run_id"]&&(string)response["native_nonce"]==(string)binding["nonce"];
            bool ok=matches&&response.ContainsKey("reviewer_result");
            string digest;using(var sha=SHA256.Create())digest=BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(text))).Replace("-","").ToLowerInvariant();
            Console.WriteLine(serializer.Serialize(new {stage="COMPLETE",appcontainer=restricted,binding_valid=bound&&matches,response_received=ok,response_file_sha256=digest}));
            return bound&&ok?0:9;
          }
        }catch(ArgumentException){} // Host may be midway through an in-place bounded write.
      }
      System.Threading.Thread.Sleep(100);
    }
    Console.WriteLine(serializer.Serialize(new {stage="TIMEOUT",appcontainer=restricted}));return 124;


  }
}
