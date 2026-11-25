using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Web.Script.Serialization;

// TEST_ONLY: frozen synthetic specification; host forwards bounded request intents to actual readonly MCP. No live DB, credentials or model.
class Launcher {
  [StructLayout(LayoutKind.Sequential)] struct SA { public int nLength; public IntPtr security; [MarshalAs(UnmanagedType.Bool)] public bool inherit; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct SI {
    public int cb; public string reserved,desktop,title; public int x,y,xSize,ySize,xCount,yCount,fill,flags;
    public short show,reservedSize; public IntPtr reservedPtr,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)] struct SIX { public SI si; public IntPtr attributes; }
  [StructLayout(LayoutKind.Sequential)] struct PI { public IntPtr process,thread; public uint pid,tid; }
  [StructLayout(LayoutKind.Sequential)] struct CAPS { public IntPtr sid,capabilities; public uint count,reserved; }
  [StructLayout(LayoutKind.Sequential)] struct MAPPING { public uint read,write,execute,all; }
  [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMIT { public long processTime,jobTime; public uint flags; public UIntPtr minWorking,maxWorking; public uint activeLimit; public UIntPtr affinity; public uint priority,scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong readOps,writeOps,otherOps,readBytes,writeBytes,otherBytes; }
  [StructLayout(LayoutKind.Sequential)] struct EXT_LIMIT { public BASIC_LIMIT basic; public IO_COUNTERS io; public UIntPtr processMemory,jobMemory,peakProcessMemory,peakJobMemory; }
  [DllImport("userenv.dll",CharSet=CharSet.Unicode)] static extern int CreateAppContainerProfile(string name,string display,string description,IntPtr caps,uint count,out IntPtr sid);
  [DllImport("userenv.dll",CharSet=CharSet.Unicode)] static extern int DeleteAppContainerProfile(string name);
  [DllImport("userenv.dll",CharSet=CharSet.Unicode)] static extern int GetAppContainerFolderPath(string sid,out IntPtr path);
  [DllImport("advapi32.dll")] static extern IntPtr FreeSid(IntPtr sid);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string application,StringBuilder command,IntPtr processAttributes,IntPtr threadAttributes,bool inherit,uint flags,IntPtr environment,string directory,ref SIX startup,out PI process);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateFile(string path,uint access,uint share,ref SA security,uint creation,uint flags,IntPtr template);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr security,string name);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref EXT_LIMIT data,int length);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint ms);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetTokenInformation(IntPtr token,int kind,IntPtr data,int size,out int needed);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool DuplicateToken(IntPtr token,int level,out IntPtr duplicate);
  [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string text,uint revision,out IntPtr descriptor,out uint size);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool AccessCheck(IntPtr descriptor,IntPtr token,uint desired,ref MAPPING mapping,IntPtr privileges,ref uint size,out uint granted,out bool allowed);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
  static void Check(bool ok,string label) { if(!ok) throw new Win32Exception(Marshal.GetLastWin32Error(),label); }
  static IntPtr Allocate(object value) { IntPtr p=Marshal.AllocHGlobal(Marshal.SizeOf(value)); Marshal.StructureToPtr(value,p,false); return p; }
  static IntPtr TokenData(IntPtr token,int kind) {
    int needed; GetTokenInformation(token,kind,IntPtr.Zero,0,out needed);
    if(needed==0) throw new Win32Exception(Marshal.GetLastWin32Error(),"Token size "+kind);
    IntPtr p=Marshal.AllocHGlobal(needed);
    if(!GetTokenInformation(token,kind,p,needed,out needed)){Marshal.FreeHGlobal(p);throw new Win32Exception(Marshal.GetLastWin32Error(),"Token query "+kind);}
    return p;
  }
  static int TokenInt(IntPtr token,int kind){IntPtr p=TokenData(token,kind);try{return Marshal.ReadInt32(p);}finally{Marshal.FreeHGlobal(p);}}
  static string TokenSid(IntPtr token,int kind){IntPtr p=TokenData(token,kind);try{return new SecurityIdentifier(Marshal.ReadIntPtr(p)).Value;}finally{Marshal.FreeHGlobal(p);}}
  static bool PackageGrant(IntPtr token,string package){
    IntPtr duplicate=IntPtr.Zero,descriptor=IntPtr.Zero,privileges=IntPtr.Zero;
    try{
      Check(DuplicateToken(token,2,out duplicate),"Duplicate query token");uint size;
      Check(ConvertStringSecurityDescriptorToSecurityDescriptor("O:SYG:SYD:(A;;0x1;;;WD)(A;;0x1;;;"+package+")",1,out descriptor,out size),"Create synthetic access descriptor");
      uint length=1024,granted;bool allowed;privileges=Marshal.AllocHGlobal((int)length);
      MAPPING mapping=new MAPPING();mapping.read=1;mapping.write=2;mapping.execute=4;mapping.all=7;
      Check(AccessCheck(descriptor,duplicate,1,ref mapping,privileges,ref length,out granted,out allowed),"Behavioral package access check");
      return allowed&&(granted&1)!=0;
    }finally{if(duplicate!=IntPtr.Zero)CloseHandle(duplicate);if(descriptor!=IntPtr.Zero)LocalFree(descriptor);if(privileges!=IntPtr.Zero)Marshal.FreeHGlobal(privileges);}
  }
  static string Dacl(string path,bool folder) {return (folder?(FileSystemSecurity)Directory.GetAccessControl(path,AccessControlSections.Access):File.GetAccessControl(path,AccessControlSections.Access)).GetSecurityDescriptorSddlForm(AccessControlSections.Access);}
  static void Restore(string path,bool folder,string sddl) {
    if(folder){DirectorySecurity acl=Directory.GetAccessControl(path,AccessControlSections.Access);acl.SetSecurityDescriptorSddlForm(sddl,AccessControlSections.Access);Directory.SetAccessControl(path,acl);}
    else{FileSecurity acl=File.GetAccessControl(path,AccessControlSections.Access);acl.SetSecurityDescriptorSddlForm(sddl,AccessControlSections.Access);File.SetAccessControl(path,acl);}
  }
  static void Grant(string path,SecurityIdentifier sid,FileSystemRights rights,bool children){
    DirectorySecurity acl=Directory.GetAccessControl(path,AccessControlSections.Access);
    acl.AddAccessRule(new FileSystemAccessRule(sid,rights,children?InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit:InheritanceFlags.None,PropagationFlags.None,AccessControlType.Allow));
    Directory.SetAccessControl(path,acl);
  }
  public static int Main(string[] args){
    string fixedRoot=Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"job"));
    bool useLpac=false;
    Dictionary<string,object> result=new Dictionary<string,object>();
    List<string> paths=new List<string>(); List<bool> folders=new List<bool>(); List<string> saved=new List<string>();
    IntPtr sid=IntPtr.Zero,list=IntPtr.Zero,cap=IntPtr.Zero,policy=IntPtr.Zero,handles=IntPtr.Zero,environment=IntPtr.Zero;
    IntPtr output=IntPtr.Zero,error=IntPtr.Zero,input=IntPtr.Zero,job=IntPtr.Zero,token=IntPtr.Zero;
    PI pi=new PI(); bool created=false,resumed=false,finished=false; string name="xmi.probe."+Guid.NewGuid().ToString("N");
    result["profile_name"]=name;result["mode"]=useLpac?"LPAC":"APPCONTAINER";result["all_application_packages_opt_out"]=useLpac; result["capability_count"]=0;result["launcher_argument_count"]=args.Length;
    try{
      string root=fixedRoot;
      string intended=Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory).TrimEnd(Path.DirectorySeparatorChar);
      if(Path.GetDirectoryName(root)!=intended||Path.GetFileName(root)!="job"||root.Contains("\""))throw new Exception("Unexpected lab root");
      if(args.Length!=0||!Directory.Exists(root)||(File.GetAttributes(root)&FileAttributes.ReparsePoint)!=0)throw new Exception("Invalid review staging directory");
      if(File.Exists(Path.Combine(root,"native-receipt.json")))throw new Exception("Prior native receipt exists");
      string runtime=Path.Combine(root,"runtime"),frozen=Path.Combine(root,"frozen");
      var settings=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(runtime,"job.json")));
      var binding=(Dictionary<string,object>)settings["job"];
      result["run_id"]=binding["run_id"];result["nonce"]=binding["nonce"];
      using(var sha=System.Security.Cryptography.SHA256.Create())result["worker_sha256"]=BitConverter.ToString(sha.ComputeHash(File.ReadAllBytes(Path.Combine(runtime,"Worker.exe")))).Replace("-","").ToLowerInvariant();
      paths.Add(root);folders.Add(true);
      foreach(string dir in Directory.GetDirectories(root,"*",SearchOption.AllDirectories)){paths.Add(dir);folders.Add(true);}
      foreach(string file in Directory.GetFiles(root,"*",SearchOption.AllDirectories)){paths.Add(file);folders.Add(false);}
      foreach(string path in paths)if((File.GetAttributes(path)&FileAttributes.ReparsePoint)!=0)throw new Exception("Reparse point in review staging directory");
      for(int i=0;i<paths.Count;i++)saved.Add(Dacl(paths[i],folders[i]));
      var canaryBytes=new Dictionary<string,byte[]>();
      foreach(string file in new string[]{"frozen/material.json","frozen/response.json","simulated-project/canonical.json","forbidden/other-project.txt","forbidden/synthetic-secret.env"})canaryBytes[Path.Combine(root,file)]=File.ReadAllBytes(Path.Combine(root,file));
      var controlInfo=new System.Diagnostics.ProcessStartInfo(Path.Combine(runtime,"Worker.exe"));
      controlInfo.UseShellExecute=false;controlInfo.CreateNoWindow=true;controlInfo.RedirectStandardOutput=true;controlInfo.RedirectStandardError=true;
      using(var control=System.Diagnostics.Process.Start(controlInfo)){
        if(!control.WaitForExit(7000)){control.Kill();throw new Exception("Unconfined native control timeout");}
        string text=control.StandardOutput.ReadToEnd();result["native_control_exit_code"]=control.ExitCode;
        File.WriteAllText(Path.Combine(root,"native-unconfined-control.json"),text,new UTF8Encoding(false));
        File.WriteAllText(Path.Combine(root,"native-unconfined-control-stderr.txt"),control.StandardError.ReadToEnd(),new UTF8Encoding(false));
        if(control.ExitCode!=0)throw new Exception("Unconfined native control failed");
      }
      foreach(var file in canaryBytes)File.WriteAllBytes(file.Key,file.Value);
      int hr=CreateAppContainerProfile(name,"XMi isolated specification review","Temporary isolated review profile",IntPtr.Zero,0,out sid);
      result["create_profile_hresult"]=hr;
      if(hr!=0)Marshal.ThrowExceptionForHR(hr); created=true;
      SecurityIdentifier principal=new SecurityIdentifier(sid); result["profile_sid"]=principal.Value;
      IntPtr profilePointer;hr=GetAppContainerFolderPath(principal.Value,out profilePointer);
      if(hr!=0)Marshal.ThrowExceptionForHR(hr);
      string profileFolder=Marshal.PtrToStringUni(profilePointer);Marshal.FreeCoTaskMem(profilePointer);
      result["profile_folder"]=profileFolder;
      Grant(root,principal,FileSystemRights.Traverse,false);
      Grant(runtime,principal,FileSystemRights.ReadAndExecute,true);
      Grant(frozen,principal,FileSystemRights.ReadAndExecute,true);
      CAPS capabilities=new CAPS();capabilities.sid=sid;cap=Allocate(capabilities);
      policy=Marshal.AllocHGlobal(4);Marshal.WriteInt32(policy,1);
      int attributeCount=useLpac?3:2;
      IntPtr size=IntPtr.Zero;InitializeProcThreadAttributeList(IntPtr.Zero,attributeCount,0,ref size);
      list=Marshal.AllocHGlobal(size);Check(InitializeProcThreadAttributeList(list,attributeCount,0,ref size),"Initialize attributes");
      Check(UpdateProcThreadAttribute(list,0,new IntPtr(0x20009),cap,new IntPtr(Marshal.SizeOf(typeof(CAPS))),IntPtr.Zero,IntPtr.Zero),"Security capabilities");
      if(useLpac)Check(UpdateProcThreadAttribute(list,0,new IntPtr(0x2000f),policy,new IntPtr(4),IntPtr.Zero,IntPtr.Zero),"LPAC policy");
      SA sa=new SA();sa.nLength=Marshal.SizeOf(typeof(SA));sa.inherit=true;
      output=CreateFile(Path.Combine(root,"worker-stdout.txt"),0x40000000,3,ref sa,1,0,IntPtr.Zero);
      Check(output!=new IntPtr(-1),"Create bounded stdout");
      error=CreateFile(Path.Combine(root,"worker-stderr.txt"),0x40000000,3,ref sa,1,0,IntPtr.Zero);
      Check(error!=new IntPtr(-1),"Create bounded stderr");
      input=CreateFile("NUL",0x80000000,3,ref sa,3,0,IntPtr.Zero);Check(input!=new IntPtr(-1),"Open null stdin");
      handles=Marshal.AllocHGlobal(3*IntPtr.Size);Marshal.WriteIntPtr(handles,0,input);Marshal.WriteIntPtr(handles,IntPtr.Size,output);Marshal.WriteIntPtr(handles,2*IntPtr.Size,error);
      Check(UpdateProcThreadAttribute(list,0,new IntPtr(0x20002),handles,new IntPtr(3*IntPtr.Size),IntPtr.Zero,IntPtr.Zero),"Restrict inherited handles");
      string sys=Environment.GetEnvironmentVariable("SystemRoot");
      string[] names={"SystemRoot","WINDIR","SystemDrive","USERPROFILE","USERNAME","USERDOMAIN","LOCALAPPDATA","APPDATA","ALLUSERSPROFILE","ProgramData","ProgramFiles","ProgramFiles(x86)","ProgramW6432","ComSpec","TEMP","TMP","OS","PROCESSOR_ARCHITECTURE","NUMBER_OF_PROCESSORS"};
      SortedDictionary<string,string> safeEnvironment=new SortedDictionary<string,string>(StringComparer.OrdinalIgnoreCase);
      foreach(string variable in names){string value=Environment.GetEnvironmentVariable(variable);if(value!=null)safeEnvironment[variable]=value;}
      safeEnvironment["PATH"]=runtime+";"+Path.Combine(sys,"System32");safeEnvironment["XMI_TEST_ONLY"]="1";
      safeEnvironment["LOCALAPPDATA"]=profileFolder;safeEnvironment["TEMP"]=Path.Combine(profileFolder,"Temp");safeEnvironment["TMP"]=safeEnvironment["TEMP"];
      Directory.CreateDirectory(safeEnvironment["TEMP"]);
      StringBuilder block=new StringBuilder();foreach(KeyValuePair<string,string> variable in safeEnvironment)block.Append(variable.Key).Append('=').Append(variable.Value).Append('\0');block.Append('\0');
      environment=Marshal.StringToHGlobalUni(block.ToString());result["environment_names"]=new List<string>(safeEnvironment.Keys);
      SIX startup=new SIX();startup.si.cb=Marshal.SizeOf(typeof(SIX));startup.si.flags=0x100;
      startup.si.input=input;startup.si.output=output;startup.si.error=error;startup.attributes=list;
      string exe=Path.Combine(runtime,"Worker.exe");
      Check(CreateProcess(exe,new StringBuilder("\""+exe+"\""),IntPtr.Zero,IntPtr.Zero,true,0x08080404,environment,runtime,ref startup,out pi),"Create suspended container worker");
      result["worker_pid"]=pi.pid;
      Check(OpenProcessToken(pi.process,10,out token),"Open worker token");
      int isApp=TokenInt(token,29),count=TokenInt(token,30);string package=TokenSid(token,31),integrity=TokenSid(token,25);
      result["token_is_appcontainer"]=isApp;result["token_capability_count"]=count;
      try{result["token_is_lpac"]=TokenInt(token,46);}catch(Win32Exception ex){result["token_is_lpac"]=null;result["lpac_direct_query_error"]=ex.NativeErrorCode;}
      bool common=PackageGrant(token,"S-1-15-2-1"),restricted=PackageGrant(token,"S-1-15-2-2");
      result["all_application_packages_grant_allowed"]=common;result["all_restricted_application_packages_grant_allowed"]=restricted;
      result["lpac_accesscheck_verified"]=!common&&restricted;
      result["requested_boundary_accesscheck_verified"]=(common==!useLpac)&&restricted;
      result["token_package_sid"]=package;result["token_integrity_sid"]=integrity;
      if(isApp!=1||common==useLpac||!restricted||count!=0||package!=principal.Value||integrity!="S-1-16-4096")throw new Exception("Effective token boundary did not match requested container policy");
      job=CreateJobObject(IntPtr.Zero,null);Check(job!=IntPtr.Zero,"Create owned job");
      EXT_LIMIT limits=new EXT_LIMIT();limits.basic.flags=0x2000;
      Check(SetInformationJobObject(job,9,ref limits,Marshal.SizeOf(typeof(EXT_LIMIT))),"Kill-on-close job limit");
      Check(AssignProcessToJobObject(job,pi.process),"Assign owned job");
      result["status"]="TOKEN_VERIFIED_BEFORE_RESUME";
      File.WriteAllText(Path.Combine(root,"native-start.json"),new JavaScriptSerializer().Serialize(result),new UTF8Encoding(false));
      Check(ResumeThread(pi.thread)!=0xffffffff,"Resume verified worker");resumed=true;
      uint waited=WaitForSingleObject(pi.process,980000);
      if(waited!=0){TerminateJobObject(job,124);WaitForSingleObject(pi.process,3000);throw new Exception("Worker wait failed or timed out: "+waited);}
      uint code;Check(GetExitCodeProcess(pi.process,out code),"Get worker exit");result["worker_exit_code"]=code;finished=true;
      result["status"]=code==0?"EXECUTED":"WORKER_FAILED";
    }catch(Exception ex){result["status"]="UNVERIFIED_OR_FAILED";result["error"]=ex.GetType().Name+": "+ex.Message;
      Win32Exception native=ex as Win32Exception;if(native!=null)result["win32_error"]=native.NativeErrorCode;
    }finally{
      if(pi.process!=IntPtr.Zero&&!finished){if(job!=IntPtr.Zero)TerminateJobObject(job,125);else TerminateProcess(pi.process,125);WaitForSingleObject(pi.process,3000);}
      foreach(IntPtr h in new IntPtr[]{token,pi.thread,pi.process,job,input,output,error})if(h!=IntPtr.Zero&&h!=new IntPtr(-1))CloseHandle(h);
      if(list!=IntPtr.Zero){DeleteProcThreadAttributeList(list);Marshal.FreeHGlobal(list);}
      foreach(IntPtr p in new IntPtr[]{cap,policy,handles,environment})if(p!=IntPtr.Zero)Marshal.FreeHGlobal(p);
      bool restored=true;List<string> cleanupErrors=new List<string>();
      for(int i=0;i<saved.Count;i++){try{Restore(paths[i],folders[i],saved[i]);if(Dacl(paths[i],folders[i])!=saved[i])restored=false;}catch(Exception ex){restored=false;cleanupErrors.Add(ex.Message);}}
      result["fixture_acls_restored"]=restored;result["cleanup_errors"]=cleanupErrors;
      if(created){int hr=DeleteAppContainerProfile(name);result["delete_profile_hresult"]=hr;result["profile_deleted"]=hr==0;}
      if(sid!=IntPtr.Zero)FreeSid(sid);result["worker_resumed"]=resumed;
    }
    string json=new JavaScriptSerializer().Serialize(result);
    string receipt=Path.Combine(fixedRoot,"native-receipt.json");
    if(!File.Exists(receipt))File.WriteAllText(receipt,json,new UTF8Encoding(false));
    Console.WriteLine(json);
    return 0;
  }
}
