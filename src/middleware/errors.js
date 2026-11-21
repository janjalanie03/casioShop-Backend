import { ZodError } from 'zod';
export function errors(err,req,res,next){
 if(err instanceof ZodError)return res.status(422).json({success:false,error:{code:'VALIDATION_ERROR',message:'Invalid input',details:err.issues},requestId:req.id});
 const code=err.code||'INTERNAL_ERROR';const status=err.status||500;
 if(status>=500) console.error('Request error',req.id,code,err.message);
 return res.status(status).json({success:false,error:{code:status>=500?'INTERNAL_ERROR':code,message:status>=500?'Unexpected server error':err.message,...(status<500&&err.details?{details:err.details}:{})},requestId:req.id});
}
