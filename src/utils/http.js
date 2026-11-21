export class HttpError extends Error { constructor(status,code,message,details){super(message);this.status=status;this.code=code;this.details=details;} }
export const fail = (status,code,message,details)=>{throw new HttpError(status,code,message,details)};
export const ok=(res,data,meta,status=200)=>res.status(status).json({success:true,data,...(meta?{meta}:{})});
export const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
export function result({data,error},status=500){if(error)fail(status,error.code||'DATABASE_ERROR',error.message);return data;}
export const money=n=>Math.round(Number(n)*100)/100;
